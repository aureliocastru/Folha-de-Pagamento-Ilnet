import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { IxcClient } from '../ixc/ixc.client';
import {
  buildAuditoriaPayload,
  buildBaixaContaPagarPayload,
  codigoTipoPagamentoBaixa,
  descontoQueOIxcAceita,
  descontosQueCabem,
  lerSituacaoContaPagar,
  lerStatusAuditoria,
  montarHistoricoBaixa,
} from '../ixc/ixc.financeiro';
import { parseIxcId } from '../ixc/ixc.parse';
import { PrismaService } from '../prisma/prisma.service';
import { campoDeBaixa, statusDizPago } from './contas-abertas.mapper';

/** Por onde o dinheiro sai. */
export type FormaDePagar = 'BANCO' | 'EM_MAOS';

/** O que dá para mudar num título que ainda está em aberto. */
export interface EdicaoDoTitulo {
  valor?: number;
  dataVencimento?: string;
  observacao?: string;
  tipoPagamento?: string;
  contaPagamento?: number;
  contaContabil?: number;
  chavePix?: string;
  codigoBarras?: string;
  documento?: string;
}

/** O que aconteceu com o título no IXC. */
export interface ResultadoDoPagamento {
  idFnApagar: number;
  /** Passou pela auditoria agora, ou já estava aprovado antes. */
  aprovada: boolean;
  /** Deu baixa: o IXC passa a considerar a conta quitada. */
  paga: boolean;
  /** O que o título devia. */
  valor: number;
  /** Quanto de fato saiu do caixa: `valor` menos o desconto. */
  valorPago: number;
  /**
   * O desconto obtido nesta baixa — quanto a empresa deixou de gastar por
   * pagar adiantado. Zero no caso comum.
   */
  desconto: number;
  /** Conta de onde o dinheiro saiu (ou vai sair, no caso do ModoBank). */
  contaPagamento: number;
  /**
   * A conta ficou aprovada esperando o banco pagar, em vez de baixada aqui. É
   * o caso do ModoBank, que paga pela tela dele no IXC.
   */
  aguardandoBanco: boolean;
  /** O que não impediu o pagamento, mas quem clicou precisa saber. */
  avisos: string[];
}

/**
 * O endpoint que quita uma conta a pagar no IXC — o "Baixa manual (Pagar)" de
 * Sistema > Pagar > Botões, na coleção em `docs/ixc`.
 *
 * Era `fn_apagar_pagamentos_baixas`, que a coleção também traz, numa seção
 * antiga com o mesmo nome de operação e o mesmo corpo. A diferença é que **esta
 * instalação não o serve**: ele responde "Erro inesperado, tente novamente!" a
 * qualquer chamada, até a uma leitura — enquanto um recurso realmente
 * desconhecido responde "Recurso X não está disponível". Ou seja, o IXC trata o
 * endpoint aposentado como se o problema fosse a requisição, e foi isso que
 * escondeu a causa: pagamentos pararam sem ninguém saber por quê, ainda mais
 * porque o motivo vinha num campo da resposta que não era lido e a tela mostrava
 * só "HTTP 200".
 *
 * Havendo dois nomes documentados para a mesma operação, vale o que a base
 * responde — e este foi confirmado nela, quitando um título de verdade.
 *
 * O número no nome é o id da tela no IXC, mesmo padrão de
 * `botao_estornar_cancelamento_26200` e `baixar_comodato_23069`. Se uma
 * atualização mudar esse id, é esta linha que muda.
 */
const ENDPOINT_BAIXA = 'botao_pagar_26409';

/**
 * Pagar uma conta do IXC daqui.
 *
 * São dois caminhos, e a diferença é de onde sai o dinheiro:
 *
 * - **pelo banco**: o título é aprovado na auditoria e fica pronto para o
 *   pagamento sair por lá, no fluxo do banco. Nenhum dinheiro se move agora —
 *   quem paga é o banco, depois.
 * - **em mãos**: aprova e dá a baixa na conta do caixa configurado. Aqui a
 *   conta fica paga no IXC no ato, porque o dinheiro já saiu da gaveta.
 *
 * As duas escritas são no financeiro de verdade da empresa. O serviço confere
 * a situação do título antes de tocar em qualquer coisa: pagar de novo o que
 * já está pago tiraria o dinheiro duas vezes do caixa, e é o erro mais caro
 * que esta tela pode cometer.
 */

@Injectable()
export class PagamentosService {
  private readonly logger = new Logger(PagamentosService.name);

  constructor(
    private readonly ixc: IxcClient,
    private readonly config: ConfigFinanceiraService,
    private readonly prisma: PrismaService,
    // Quem sabe o que cai junto quando uma conta a pagar some daqui.
    private readonly contasPagar: ContasPagarService,
  ) {}

  async pagar(
    idFnApagar: number,
    opcoes: {
      /**
       * Conta de onde o dinheiro sai. Vazio = a que o título já traz, e na
       * falta dela a padrão da configuração.
       *
       * É ela que decide o resto: a conta do ModoBank só é aprovada, porque o
       * pagamento sai pela tela dele no IXC — este app não tem permissão para
       * acionar aquele botão. Qualquer outra conta é aprovada **e** baixada
       * aqui, que é o que evita ter de repetir o pagamento à mão lá.
       */
      contaPagamento?: number;
      data?: string;
      historico?: string;
      /**
       * O dinheiro já saiu antes deste título existir — é o lançamento de uma
       * conta que foi paga pela conta bancária e só agora está sendo registrada.
       *
       * Serve para uma coisa só: dispensar a espera pelo banco. A conta do
       * ModoBank normalmente para no aprovar, porque quem paga é ele e marcá-la
       * como paga antes disso seria dar por saído um dinheiro que ainda está lá.
       * Quando quem chama afirma que a saída já aconteceu, essa premissa não
       * existe mais — e a baixa aqui é a mesma que se daria à mão no IXC.
       */
      jaSaiu?: boolean;
      /**
       * Desconto por pagar adiantado, em reais.
       *
       * O título continua devendo o que devia — o que muda é quanto sai do
       * caixa. Vai ao IXC como desconto da baixa, e é ele que faz a
       * movimentação financeira sair pelo valor líquido, que é o que a
       * conciliação vai achar no extrato.
       */
      desconto?: number;
      /** @deprecated A conta escolhida é quem manda; fica por compatibilidade. */
      forma?: FormaDePagar;
    },
    usuarioNome?: string,
  ): Promise<ResultadoDoPagamento> {
    const avisos: string[] = [];
    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      idFnApagar,
    );
    if (!raw) {
      throw new BadRequestException(
        `O título ${idFnApagar} não existe mais no IXC.`,
      );
    }

    const situacao = lerSituacaoContaPagar(raw);
    if (situacao.pago) {
      throw new BadRequestException(
        `O título ${idFnApagar} já consta pago no IXC` +
          (situacao.dataPagamento
            ? ` (em ${situacao.dataPagamento.toLocaleDateString('pt-BR')})`
            : '') +
          '. Pagar de novo tiraria o dinheiro duas vezes.',
      );
    }
    if (situacao.cancelada) {
      throw new BadRequestException(
        `O título ${idFnApagar} está cancelado no IXC e não deve ser pago.`,
      );
    }

    const valor = situacao.valorAberto;
    if (valor < 0.01) {
      throw new BadRequestException(
        `O título ${idFnApagar} está sem saldo a pagar.`,
      );
    }

    /*
     * O desconto é conferido contra o saldo lido agora, e não contra o valor
     * que a tela mostrava: entre abrir a janela e confirmar, alguém pode ter
     * editado o título no IXC. Desconto que come o título inteiro não é
     * pagamento — é baixa por zero, e quem quer isso quer cancelar a conta.
     */
    const desconto = Math.round(Math.max(0, opcoes.desconto ?? 0) * 100) / 100;
    if (desconto >= valor) {
      throw new BadRequestException(
        `O desconto (${moeda(desconto)}) não pode alcançar o valor do título ` +
          `${idFnApagar} (${moeda(valor)}) — não sobraria pagamento nenhum.`,
      );
    }
    /*
     * O desconto precisa caber no campo do IXC antes de sair daqui.
     *
     * Lá ele é guardado como percentual do título, com quatro casas — e um
     * centavo de desconto num título de trinta mil é 0,0000333%, que
     * arredondado vira zero. O IXC recusa isso, e recusa **depois** de a conta
     * ter ido: o pagamento não sai, mas quem clicou fica com uma mensagem
     * sobre casas decimais e sem saber que valor serve.
     *
     * Conferir aqui troca isso por uma recusa que diz o que fazer, e sem ida
     * ao financeiro de verdade.
     */
    if (desconto > 0) {
      const cabimento = descontoQueOIxcAceita(valor, desconto);
      if (!cabimento.cabe) {
        const vizinhos = descontosQueCabem(valor, desconto);
        // Desconto zero não é sugestão de nada: quando o vizinho de baixo é
        // zero, o que existe para dizer é qual é o menor que serve.
        const saida =
          vizinhos.abaixo > 0
            ? `os descontos mais próximos que ele aceita são ` +
              `${moeda(vizinhos.abaixo)} e ${moeda(vizinhos.acima)}`
            : `o menor desconto que ele aceita é ${moeda(vizinhos.acima)}`;

        throw new BadRequestException(
          `O IXC guarda o desconto como percentual do título, com quatro ` +
            `casas — e ${moeda(desconto)} em ${moeda(valor)} dá ` +
            `${cabimento.percentual}%, que aplicado vira ` +
            `${moeda(cabimento.aplicado)}. Neste título, ${saida}. Nada foi ` +
            'pago.',
        );
      }
    }

    const valorPago = Math.round((valor - desconto) * 100) / 100;

    // --- 1. Auditoria ---
    // Reprovado é decisão de alguém: destravar isso daqui por baixo seria
    // passar por cima de quem reprovou.
    const auditoriaAtual = lerStatusAuditoria(raw);
    if (auditoriaAtual === 'R') {
      throw new BadRequestException(
        `O título ${idFnApagar} foi reprovado na auditoria do IXC. Resolva por ` +
          'lá antes de pagar.',
      );
    }

    let aprovada = auditoriaAtual === 'A';
    if (!aprovada) {
      await this.ixc.create(
        'fn_apagar_auditoria',
        buildAuditoriaPayload({
          idFnApagar,
          status: 'A',
          motivo: 'Aprovado pelo ILNET FINANCE',
          operador: usuarioNome ?? '',
        }),
      );
      aprovada = true;
      this.logger.log(`Título ${idFnApagar} aprovado na auditoria do IXC.`);
    }

    // --- 2. De onde o dinheiro sai, que é o que decide se há baixa ---
    const cfg = await this.config.obter();
    const contaPagamentoId =
      opcoes.contaPagamento ??
      parseIxcId(raw.id_contas) ??
      cfg.contaPagamentoId;
    const filialId = parseIxcId(raw.filial_id) ?? cfg.filialId;

    /*
     * A conta do banco que paga por integração — o ModoBank — para no aprovar.
     * O pagamento dela sai pela tela do IXC, com um botão que este app não tem
     * permissão para acionar; dar baixa aqui marcaria como paga uma conta que o
     * banco ainda não pagou, e o dinheiro sairia depois, sem registro do outro
     * lado batendo.
     *
     * `jaSaiu` desfaz exatamente essa premissa: a conta está sendo lançada
     * depois de já ter sido paga, então não há pagamento futuro para esperar.
     */
    if (contaPagamentoId === cfg.contaPagamentoId && !opcoes.jaSaiu) {
      /*
       * Aqui nenhum desconto é aplicado, e o aviso diz isso: quem paga é o
       * banco, pela tela dele, e é lá que o abatimento teria de ser informado.
       * Guardá-lo em silêncio faria a economia aparecer neste app sem que um
       * centavo a menos tivesse saído.
       */
      if (desconto > 0) {
        avisos.push(
          `O desconto de ${moeda(desconto)} não foi aplicado: por esta conta o ` +
            'pagamento sai pela tela do banco no IXC, e é lá que ele precisa ' +
            'ser informado.',
        );
      }
      return {
        idFnApagar,
        aprovada,
        paga: false,
        valor,
        valorPago: valor,
        desconto: 0,
        contaPagamento: contaPagamentoId,
        aguardandoBanco: true,
        avisos,
      };
    }

    /*
     * Qualquer outra conta é dinheiro que sai por fora da integração — caixa,
     * outro banco, cartão. Aqui a baixa é a mesma que se daria à mão no IXC, e
     * "a mesma" é para valer: o corpo sai igual ao que a tela de baixa manda,
     * campo por campo, incluindo os rótulos dos campos de seleção.
     *
     * O que faltava era o `tipo_pagamento`. Ele ia sempre como "D" (dinheiro),
     * porque ninguém o informava e o padrão servia ao pagamento em mãos — então
     * um PIX saindo da conta do banco entrava na movimentação financeira como
     * dinheiro. O título constava pago, e o movimento não aparecia para
     * conciliar com o extrato: dinheiro em conta bancária não é movimento de
     * banco. Agora ele sai do próprio título, que é onde a forma de pagamento
     * foi decidida.
     */
    const documento = textoOuNull(raw.documento);
    const [conta, filialNome] = await Promise.all([
      this.contaDePagamento(contaPagamentoId),
      this.nomeDaFilial(filialId),
    ]);

    /*
     * Sem o razão da conta de pagamento, a baixa não sai daqui.
     *
     * O `id_conta` da baixa é a conta do razão do banco, e é nela que o IXC
     * escreve a perna do dinheiro saindo — a que a conciliação lê. Sem ela,
     * antes, ia a conta contábil do título: o IXC escrevia as duas pernas na
     * conta da despesa, o título constava pago e a conciliação não tinha o que
     * listar. Oito pagamentos de agosto ficaram assim, e cada um só se conserta
     * estornando e refazendo à mão.
     *
     * Por isso agora recusa, e recusa **antes** de mandar a baixa: aqui nada
     * saiu ainda, o título continua aprovado, e quem clicou repete o pagamento.
     * O barato de deixar passar é caro depois — pagamento que não concilia só
     * aparece no fechamento do mês, quando ninguém lembra de qual foi.
     */
    if (conta.planejamento === null) {
      throw new ServiceUnavailableException(
        `Não deu para ler no IXC a conta do razão da conta de pagamento ` +
          `${contaPagamentoId}${conta.nome ? ` (${conta.nome})` : ''}. Sem ela ` +
          'a baixa não entraria na conciliação bancária, então nada foi pago. ' +
          'Tente de novo; se insistir, confira a "Conta contábil analítica" no ' +
          'cadastro dessa conta no IXC.',
      );
    }

    const payloadDaBaixa = buildBaixaContaPagarPayload({
      idFnApagar,
      contaPagamentoId,
      contaPagamentoNome: conta.nome,
      contaPlanejamentoId: conta.planejamento,
      filialId,
      filialNome,
      valor,
      desconto,
      data: opcoes.data ? dataUtc(opcoes.data) : new Date(),
      documento,
      tipoPagamento: codigoTipoPagamentoBaixa(
        textoOuNull(raw.tipo_pagamento),
        contaPagamentoId === cfg.contaPagamentoCaixaId,
      ),
      historico:
        opcoes.historico?.trim() ||
        montarHistoricoBaixa({
          beneficiario: await this.nomeDoBeneficiario(idFnApagar, raw),
          documento,
        }),
    });

    let recusa: string | null = null;
    try {
      await this.ixc.action(ENDPOINT_BAIXA, payloadDaBaixa);
    } catch (err) {
      /*
       * A recusa é anotada, não relançada aqui.
       *
       * O IXC já recusou a baixa **e mesmo assim a gravou** — respondendo HTTP
       * 200 com `type: error` e sem mensagem. Desistir na recusa deixava quem
       * pagou diante de um "não saiu" para uma conta que lá constava quitada, e
       * o passo seguinte natural — pagar de novo — tira o dinheiro duas vezes.
       *
       * Quem decide se saiu é o próprio IXC, na leitura abaixo.
       */
      recusa = err instanceof Error ? err.message : String(err);
      /*
       * O que foi mandado vai para o log junto com a recusa.
       *
       * O IXC recusa esta chamada sem dizer por quê — HTTP 200, `type: error`,
       * `message` vazia. Com só um dos lados da conversa registrado não há como
       * descobrir qual campo ele não aceitou, e o caso não se reproduz fora da
       * base real. Aqui não há segredo: são códigos de conta, valor e data.
       */
      this.logger.warn(
        `Título ${idFnApagar}: o IXC recusou a baixa (${recusa}). ` +
          `Enviado: ${JSON.stringify(payloadDaBaixa)}. ` +
          'Relendo o título para saber se ela pegou assim mesmo.',
      );
    }

    // A única pergunta que importa depois de mexer em dinheiro: a conta ficou
    // quitada lá? Vale tanto para a baixa aceita quanto para a recusada.
    const depois = await this.ixc
      .getById<Record<string, unknown>>('fn_apagar', 'fn_apagar.id', idFnApagar)
      .catch(() => null);

    if (!depois) {
      // Sem conseguir reler, não dá para afirmar nada. Na recusa isso é grave o
      // bastante para parar: dizer "pago" seria adivinhar sobre dinheiro.
      if (recusa) {
        throw new ServiceUnavailableException(
          `O IXC recusou a baixa do título ${idFnApagar} (${recusa}) e não ` +
            'respondeu à conferência. Confira no IXC se ela saiu antes de ' +
            'pagar de novo.',
        );
      }
      avisos.push(
        'Não deu para reler o título no IXC depois da baixa — confira por lá.',
      );
    }

    const paga = depois ? lerSituacaoContaPagar(depois).pago : true;

    if (recusa && !paga) {
      throw new ServiceUnavailableException(`IXC: ${recusa}`);
    }
    if (recusa && paga) {
      this.logger.log(
        `Título ${idFnApagar}: o IXC recusou a resposta mas a conta consta ` +
          'quitada lá — baixa dada por boa.',
      );
      avisos.push(
        `O IXC recusou a resposta da baixa (${recusa}), mas o título consta ` +
          'quitado por lá. O pagamento saiu — não repita, e confira o ' +
          'lançamento no IXC se quiser ter certeza.',
      );
    }
    if (!recusa && depois && !paga) {
      avisos.push(
        'O IXC aceitou a baixa, mas o título continua aparecendo como aberto ' +
          'por lá. Confira no IXC antes de considerar essa conta paga.',
      );
    }

    if (paga) {
      this.logger.log(
        `Título ${idFnApagar} baixado no IXC: ${valorPago} pela conta ` +
          `${contaPagamentoId}` +
          (desconto > 0 ? ` (${valor} com ${desconto} de desconto)` : '') +
          '.',
      );
    }

    return {
      idFnApagar,
      aprovada,
      paga,
      valor,
      valorPago,
      desconto,
      contaPagamento: contaPagamentoId,
      aguardandoBanco: false,
      avisos,
    };
  }

  /**
   * Paga várias contas em mãos de uma vez.
   *
   * Uma a uma, e o que já saiu fica de pé se a seguinte falhar: são pagamentos
   * de verdade, e desfazer os que deram certo por causa do que não deu seria
   * tirar dinheiro do caixa duas vezes para depois devolver. Quem clicou vê
   * quais passaram e quais não.
   */
  async pagarEmLote(
    ids: number[],
    opcoes: {
      contaPagamento?: number;
      data?: string;
      jaSaiu?: boolean;
      /**
       * Desconto por pagar adiantado. Vale para o lote de **uma** conta só —
       * ver a recusa logo abaixo.
       */
      desconto?: number;
      forma?: FormaDePagar;
    },
    usuarioNome?: string,
  ): Promise<{
    pagas: ResultadoDoPagamento[];
    falhas: Array<{ idFnApagar: number; erro: string }>;
    /** Quanto saiu do caixa ao todo — já com os descontos abatidos. */
    total: number;
    /** Quanto se deixou de gastar: a soma dos descontos obtidos. */
    economia: number;
  }> {
    const pagas: ResultadoDoPagamento[] = [];
    const falhas: Array<{ idFnApagar: number; erro: string }> = [];
    const unicos = [...new Set(ids)];

    /*
     * Um desconto para várias contas não tem resposta certa: rateá-lo pelos
     * valores inventaria um abatimento em cada título que ninguém combinou, e
     * aplicá-lo inteiro em todos multiplicaria a economia por quantas contas o
     * lote tiver. Quem negociou desconto negociou por uma conta — então essa
     * conta é paga sozinha.
     */
    if ((opcoes.desconto ?? 0) > 0 && unicos.length > 1) {
      throw new BadRequestException(
        'Desconto vale para uma conta de cada vez: não há como dividir um ' +
          `abatimento entre as ${unicos.length} deste lote. Pague com desconto ` +
          'a conta que o teve, e as outras à parte.',
      );
    }

    for (const id of unicos) {
      try {
        pagas.push(await this.pagar(id, opcoes, usuarioNome));
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Título ${id} não foi pago no lote: ${erro}`);
        falhas.push({ idFnApagar: id, erro });
      }
    }

    return {
      pagas,
      falhas,
      // O que saiu do caixa, e não o que os títulos valiam: com desconto os
      // dois números são diferentes, e o que a tela precisa mostrar depois de
      // pagar é o primeiro.
      total: Math.round(pagas.reduce((s, p) => s + p.valorPago, 0) * 100) / 100,
      economia:
        Math.round(pagas.reduce((s, p) => s + p.desconto, 0) * 100) / 100,
    };
  }

  /**
   * Muda um título em aberto no IXC — o meio de pagamento, a data, o valor.
   *
   * Conta paga não se edita: o dinheiro já saiu, e mudar o valor de um
   * pagamento feito é reescrever o passado. O caminho é estornar no IXC.
   */
  async editar(
    idFnApagar: number,
    mudancas: EdicaoDoTitulo,
  ): Promise<{
    idFnApagar: number;
    alterado: string[];
    /** Precisou reprovar e reaprovar para o IXC deixar editar. */
    reaprovada: boolean;
  }> {
    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      idFnApagar,
    );
    if (!raw) {
      throw new BadRequestException(
        `O título ${idFnApagar} não existe mais no IXC.`,
      );
    }

    const situacao = lerSituacaoContaPagar(raw);
    if (situacao.pago) {
      throw new BadRequestException(
        `O título ${idFnApagar} já está pago — estorne no IXC antes de mudar.`,
      );
    }
    if (situacao.cancelada) {
      throw new BadRequestException(
        `O título ${idFnApagar} está cancelado no IXC.`,
      );
    }

    const alterado = Object.entries(mudancas)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k]) => k);
    if (alterado.length === 0) {
      throw new BadRequestException('Nada foi alterado.');
    }

    /*
     * O IXC recusa editar conta com auditoria aprovada — e as contas lançadas
     * daqui nascem aprovadas justamente para o banco poder pagá-las. Sem isto,
     * toda edição esbarrava em "não é possível editar uma conta a pagar que
     * esteja com auditoria aprovada".
     *
     * Então o ciclo é: reprova, edita, aprova de novo. A reprovação dura o
     * tempo da escrita e o `finally` garante que ela seja desfeita mesmo se a
     * edição falhar — deixar a conta reprovada por causa de um erro de rede
     * seria pior que não ter editado, porque ela pararia de ser pagável.
     */
    const estavaAprovada = lerStatusAuditoria(raw) === 'A';
    if (estavaAprovada) {
      await this.auditar(idFnApagar, 'R', 'Reaberta para edição pelo ILNET FINANCE');
    }

    try {
      await this.ixc.update(
        'fn_apagar',
        idFnApagar,
        await montarEdicao(raw, mudancas),
      );
    } finally {
      if (estavaAprovada) {
        await this.auditar(
          idFnApagar,
          'A',
          'Reaprovada após edição pelo ILNET FINANCE',
        ).catch((err: unknown) => {
          // Aqui não dá para desistir em silêncio: a conta ficaria reprovada.
          this.logger.error(
            `Título ${idFnApagar} ficou REPROVADO no IXC — a reaprovação ` +
              `falhou: ${err instanceof Error ? err.message : String(err)}. ` +
              'Aprove pela lista.',
          );
        });
      }
    }

    this.logger.log(
      `Título ${idFnApagar} alterado no IXC: ${alterado.join(', ')}.`,
    );

    return { idFnApagar, alterado, reaprovada: estavaAprovada };
  }

  /**
   * Pergunta ao IXC como é uma baixa que ele aceitou, e põe lado a lado com a
   * que ele acabou de recusar.
   *
   * O motivo que ele dá é "Erro inesperado, tente novamente!" — genérico, e não
   * aponta campo nenhum. Sem a documentação do webservice, o único jeito de
   * descobrir o que falta é olhar uma linha real da tabela: é o mesmo caminho
   * que este app já usa para a Classificação de ISS e para a marcação de
   * diarista, copiar do que existe em vez de adivinhar.
   *
   * Só lê e só registra: nunca lança, porque isto roda depois de uma falha e
   * não pode virar uma segunda falha por cima dela.
   */
  /**
   * O nome da conta de onde o dinheiro sai ("CX - Werick", "Conta ModoBank
   * PIX"), para o rótulo que a tela de baixa manda junto do id.
   *
   * Falhar aqui não derruba o pagamento: o rótulo é enfeite ao lado do id, que
   * é quem de fato aponta a conta. Uma consulta a mais não pode ser o motivo de
   * um pagamento não sair.
   */
  private async nomeDaConta(id: number): Promise<string | null> {
    return (await this.contaDePagamento(id)).nome;
  }

  /**
   * O cadastro da conta de onde o dinheiro sai: o nome e, sobretudo, a conta do
   * **razão** dela (`id_planejamento`).
   *
   * O razão é o que faz a baixa lançar na conta bancária, e é dessa conta que a
   * tela de conciliação lê os movimentos. Sem ele a baixa escreve as duas
   * pernas do lançamento na conta da despesa e o banco não vê nada.
   */
  private async contaDePagamento(
    id: number,
  ): Promise<{ nome: string | null; planejamento: number | null }> {
    try {
      const conta = await this.ixc.getById<Record<string, unknown>>(
        'contas',
        'contas.id',
        id,
      );
      if (!conta) return { nome: null, planejamento: null };
      return {
        nome: textoOuNull(conta.conta ?? conta.descricao),
        planejamento: parseIxcId(conta.id_planejamento),
      };
    } catch {
      return { nome: null, planejamento: null };
    }
  }

  /** O nome da filial, pelo mesmo motivo — e com a mesma tolerância a falha. */
  private async nomeDaFilial(id: number): Promise<string | null> {
    try {
      const filial = await this.ixc.getById<Record<string, unknown>>(
        'filial',
        'filial.id',
        id,
      );
      return filial ? textoOuNull(filial.filial ?? filial.razao_social) : null;
    } catch {
      return null;
    }
  }

  /**
   * Quem recebeu, para o histórico sair como o do IXC ("Pag. Fulano - doc.: 9").
   *
   * O cadastro daqui vem primeiro porque é o nome que a pessoa escolheu na
   * tela; depois o que o próprio título trouxer. Sem nenhum dos dois o
   * histórico sai só com o documento — melhor curto do que errado.
   */
  private async nomeDoBeneficiario(
    idFnApagar: number,
    raw: Record<string, unknown>,
  ): Promise<string | null> {
    const local = await this.prisma.contaPagar.findFirst({
      where: { idFnApagarIxc: idFnApagar },
      select: { beneficiarioNome: true },
      orderBy: { createdAt: 'desc' },
    });
    if (local?.beneficiarioNome) return local.beneficiarioNome;
    return textoOuNull(raw.fornecedor ?? raw.razao_social ?? raw.nome);
  }

  /** Um passo de auditoria no IXC: aprovar ou reprovar com o motivo. */
  private async auditar(
    idFnApagar: number,
    status: 'A' | 'R',
    motivo: string,
  ): Promise<void> {
    await this.ixc.create(
      'fn_apagar_auditoria',
      buildAuditoriaPayload({ idFnApagar, status, motivo, operador: '' }),
    );
  }

  /**
   * Apaga vários títulos de uma vez. Um que falhe não impede os outros: são
   * registros independentes no IXC, e parar no primeiro erro deixaria metade
   * da seleção apagada sem dizer qual metade.
   */
  async excluirEmLote(
    ids: number[],
  ): Promise<{
    apagados: number[];
    falhas: Array<{ idFnApagar: number; erro: string }>;
  }> {
    const apagados: number[] = [];
    const falhas: Array<{ idFnApagar: number; erro: string }> = [];

    for (const id of [...new Set(ids)]) {
      try {
        await this.excluir(id);
        apagados.push(id);
      } catch (err) {
        falhas.push({
          idFnApagar: id,
          erro: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { apagados, falhas };
  }

  /**
   * Apaga um título do IXC.
   *
   * Só o que nunca teve baixa: apagar um título baixado sumiria com o registro
   * de uma saída de dinheiro que existiu. Se ele nasceu aqui, o registro deste
   * lado vai junto — deixá-lo apontando para um título que não existe mais
   * faria a conferência de pagamentos procurar um fantasma.
   *
   * A trava aqui é mais larga que a de pagar de propósito, e isso custou R$
   * 300,00 para ser aprendido. Ela usava `lerSituacaoContaPagar().pago`, que
   * pergunta "esta conta está quitada?" — e quitada, nesta base, quer dizer
   * status "P" (que ela não usa: aqui é "F"), ou data de pagamento preenchida,
   * ou saldo zerado. Um título baixado que não caísse em nenhuma das três
   * passava por "não pago" e era apagado.
   *
   * O que apagar destrói não é a quitação: é a **baixa**. Ela move dinheiro no
   * `fn_movim_finan` do IXC, e apagar o título de `fn_apagar` não desfaz esse
   * movimento — sobra uma saída no caixa sem nada atrás dela, que foi
   * exatamente o que aconteceu num acerto da rua. Por isso a pergunta certa é
   * "houve baixa?", e não "está quitado?": baixa parcial também tirou dinheiro
   * da gaveta.
   */
  async excluir(idFnApagar: number): Promise<{ idFnApagar: number }> {
    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      idFnApagar,
    );
    if (!raw) {
      throw new BadRequestException(
        `O título ${idFnApagar} não existe mais no IXC.`,
      );
    }

    const marca = marcaDeBaixa(raw);
    if (marca) {
      throw new BadRequestException(
        `O título ${idFnApagar} já teve baixa no IXC (${marca}). Apagar ` +
          'sumiria com o registro de um dinheiro que saiu, e a saída no caixa ' +
          'ficaria sem nada atrás dela. Estorne o pagamento no IXC ' +
          '(Pagar > Estornar pagamento recebido) e apague depois, se for o caso.',
      );
    }

    await this.ixc.remove('fn_apagar', idFnApagar);
    /*
     * Apagado é apagado: vai junto o que só existia por causa desta conta.
     *
     * Aqui havia um `deleteMany` na `ContaPagar` e mais nada. A FK do pagamento
     * avulso é `SetNull`, então o pagamento não ia junto — ficava sem conta a
     * pagar e sem lançamento no caixa, contado como "já saiu" e invisível como
     * pendente. Foi assim que um acerto de teste apagado continuou somando duas
     * vendas no painel.
     *
     * A regra do que cai junto mora no `ContasPagarService`, que é quem já a
     * tinha: dois lugares decidindo isso foi o que abriu o buraco.
     */
    await this.contasPagar.apagarLocalPorTituloIxc(idFnApagar);
    this.logger.log(`Título ${idFnApagar} apagado do IXC.`);

    return { idFnApagar };
  }
}

/**
 * Por que este título não pode mais ser apagado — ou `null` se nunca teve
 * baixa.
 *
 * Devolve o **motivo por extenso** e não um booleano porque a frase da recusa
 * precisa dele: "já teve baixa" sem dizer por onde se soube manda a pessoa
 * procurar no IXC uma coisa que ela não sabe nomear.
 *
 * As três perguntas são independentes de propósito. Cada uma pega um jeito
 * diferente de a baixa ter acontecido, e nenhuma delas pega todos: o status
 * desta base é "F" e não o "P" da documentação; a coluna da data varia de
 * instalação para instalação (por isso `CAMPOS_DE_BAIXA` é uma lista); e há
 * títulos baixados aqui cuja data não estava em nenhuma das colunas — é o caso
 * que o histórico de pagamentos chama de `fonteDaData: 'titulo'`.
 */
export function marcaDeBaixa(raw: Record<string, unknown>): string | null {
  if (statusDizPago(raw)) {
    return `status "${String(raw.status ?? '').trim()}"`;
  }

  const campo = campoDeBaixa(raw);
  if (campo) return `a coluna ${campo}`;

  const situacao = lerSituacaoContaPagar(raw);
  // Baixa parcial: sobrou saldo, mas dinheiro já saiu da gaveta por este
  // título. Apagá-lo apaga o registro do que saiu.
  if (situacao.valorPago > 0.005) {
    return `R$ ${situacao.valorPago.toFixed(2)} já pagos`;
  }

  return null;
}

/**
 * Muda um título que ainda está em aberto no IXC.
 *
 * O registro é lido antes e devolvido inteiro, com as mudanças por cima: o
 * `PUT` do webservice reescreve a linha, e mandar só o campo alterado apaga o
 * resto — a conta perderia fornecedor, valor e vencimento de uma vez.
 */
export async function montarEdicao(
  atual: Record<string, unknown>,
  mudancas: EdicaoDoTitulo,
): Promise<Record<string, unknown>> {
  const texto = (v: unknown) => String(v ?? '').trim();

  return {
    id_fornecedor: texto(atual.id_fornecedor),
    data_emissao: formatDataIxcDeIso(texto(atual.data_emissao)),
    data_vencimento: mudancas.dataVencimento
      ? formatDataIxcDeIso(mudancas.dataVencimento)
      : formatDataIxcDeIso(texto(atual.data_vencimento)),
    valor:
      mudancas.valor !== undefined
        ? mudancas.valor.toFixed(2)
        : texto(atual.valor),
    id_contas: String(mudancas.contaPagamento ?? texto(atual.id_contas)),
    id_conta: String(mudancas.contaContabil ?? texto(atual.id_conta)),
    filial_id: texto(atual.filial_id) || '1',
    tipo_pagamento: mudancas.tipoPagamento ?? texto(atual.tipo_pagamento),
    chave_pix: mudancas.chavePix ?? texto(atual.chave_pix),
    codigo_barras:
      mudancas.codigoBarras !== undefined
        ? mudancas.codigoBarras.replace(/\D/g, '')
        : texto(atual.codigo_barras),
    documento: mudancas.documento ?? texto(atual.documento),
    numero_nota: texto(atual.numero_nota),
    obs: mudancas.observacao ?? texto(atual.obs),
    // O que decide se a conta existe para o financeiro do IXC não é mexido
    // aqui: uma edição de meio de pagamento não pode cancelar nem "desliberar"
    // o título.
    previsao: texto(atual.previsao) || 'N',
    liberado: texto(atual.liberado) || 'S',
  };
}

/** "AAAA-MM-DD" (como o IXC devolve na leitura) → "DD/MM/AAAA" (como ele aceita). */
function formatDataIxcDeIso(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  // Já veio no formato brasileiro (ou vazio): devolve como está.
  return valor;
}

/** "AAAA-MM-DD" → meia-noite em UTC, como o resto das datas desta base. */
function dataUtc(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** Reais como quem lê a mensagem de erro os escreveria. */
function moeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function textoOuNull(valor: unknown): string | null {
  const s = String(valor ?? '').trim();
  return s || null;
}
