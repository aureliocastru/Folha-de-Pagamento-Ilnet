import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ContaPagar } from '@prisma/client';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { CategoriasService } from './categorias.service';
import { CriarDespesaDto } from './dto/despesa.dto';
import { PagamentosService } from './pagamentos.service';
import {
  conferirArquivo,
  emMegabytes,
  extensaoDoTipo,
  lerDataUrl,
} from '../arquivos/data-url';
import { IxcClient } from '../ixc/ixc.client';
import { parseIxcId } from '../ixc/ixc.parse';
import { PrismaService } from '../prisma/prisma.service';

/** O que aconteceu ao dar por paga a conta recém-lançada. */
export interface BaixaDoLancamento {
  /** Quantas contas ficaram quitadas no IXC. */
  pagas: number;
  /** Quantas se tentou baixar — passa de uma quando é parcelado. */
  tentadas: number;
  /** Total que o IXC deu por pago. */
  valor: number;
  /** Dia que ficou registrado na baixa (AAAA-MM-DD). */
  data: string;
  /** O que não saiu como esperado. Vazio = correu tudo bem. */
  avisos: string[];
}

/** O que aconteceu ao lançar uma despesa à mão. */
export interface DespesaLancada {
  /** A primeira conta criada — a única, quando não é parcelado. */
  conta: ContaPagar;
  /** Todas as contas criadas: uma por parcela. */
  contas: ContaPagar[];
  /**
   * Por que a etiqueta não ficou, quando não ficou. A conta já existe no IXC
   * nesse caso — o que falta é só a classificação daqui, e ela se resolve na
   * própria lista de contas em aberto.
   */
  avisoCategoria: string | null;
  /** Null quando o lançamento não pediu para já sair pago. */
  baixa: BaixaDoLancamento | null;
}

/**
 * Lançar uma conta a pagar à mão, sem passar pela folha.
 *
 * Fica no módulo de contas em aberto porque é dali que ela nasce, na tela em
 * que se olha o que a empresa deve. O trabalho pesado continua no
 * `ContasPagarService` — é o mesmo caminho até o `fn_apagar` que a folha usa,
 * com a mesma auditoria e o mesmo acompanhamento do pagamento.
 */
@Injectable()
export class DespesasService {
  private readonly logger = new Logger(DespesasService.name);

  constructor(
    private readonly contasPagar: ContasPagarService,
    private readonly categorias: CategoriasService,
    private readonly pagamentos: PagamentosService,
    private readonly ixc: IxcClient,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * As notas que um título já tem, lidas do IXC.
   *
   * É a mesma lista que a aba "Arquivos" da tela dele mostra — e é ela que
   * responde "a nota subiu mesmo?", que é a pergunta de quem acabou de anexar.
   */
  async notas(idFnApagar: number): Promise<NotaDoTitulo[]> {
    const res = await this.ixc.list<Record<string, unknown>>(
      'fn_apagar_arquivos',
      {
        qtype: 'fn_apagar_arquivos.id_apagar',
        query: String(idFnApagar),
        oper: '=',
        rp: 50,
        sortname: 'fn_apagar_arquivos.id',
        sortorder: 'desc',
      },
    );

    return res.registros
      .map((raw) => {
        const id = parseIxcId(raw.id);
        if (id === null) return null;
        return {
          id,
          descricao: textoOuNull(raw.descricao) ?? 'Nota',
          extensao: (textoOuNull(raw.extensao) ?? '').replace('.', ''),
          data: textoOuNull(raw.data) ?? textoOuNull(raw.data_cadastro),
          usuario: textoOuNull(raw.usuario) ?? textoOuNull(raw.id_usuario),
        };
      })
      .filter((n): n is NotaDoTitulo => n !== null);
  }

  /**
   * O conteúdo de uma nota, para a tela abrir.
   *
   * O webservice devolve o arquivo em base64, e a coleção do IXC não diz em que
   * campo — por isso ele é procurado: o primeiro texto grande que se pareça com
   * base64 é o arquivo. Não achando, o erro diz quais campos vieram, que é o
   * que permite acertar isto sem adivinhar de novo.
   */
  async baixarNota(
    id: number,
    extensao?: string,
  ): Promise<{ conteudo: Buffer; tipo: string; nome: string }> {
    const resposta = (await this.ixc.action('fn_apagar_arquivos_download', {
      id: String(id),
    })) as Record<string, unknown>;

    const base64 = acharBase64(resposta);
    if (!base64) {
      this.logger.warn(
        `Download da nota ${id}: não achei o arquivo na resposta ` +
          `(campos: ${Object.keys(resposta).join(', ')}).`,
      );
      throw new BadRequestException(
        'O IXC respondeu, mas não achei o arquivo na resposta dele. Abra a ' +
          'nota pela aba "Arquivos" do título, no IXC.',
      );
    }

    const ext = (extensao ?? 'pdf').toLowerCase().replace('.', '');
    return {
      conteudo: Buffer.from(base64, 'base64'),
      tipo: TIPO_POR_EXTENSAO[ext] ?? 'application/octet-stream',
      nome: `nota-${id}.${ext}`,
    };
  }

  /**
   * Anexa a nota ao título, no próprio IXC.
   *
   * O papel fica onde a conta está, e não numa gaveta deste app: quem abrir o
   * título por lá — para conferir, para estornar, para responder ao contador —
   * acha a nota no mesmo lugar, sem saber que este sistema existe. O IXC tem o
   * recurso pronto para isso (`fn_apagar_arquivos`), e é ele que a tela dele
   * lista na aba de arquivos.
   *
   * Aceita imagem e PDF: é foto de cupom, digitalização de nota e print de
   * comprovante que entram aqui.
   */
  async anexarNota(
    idFnApagar: number,
    dados: { arquivo: string; nome?: string; descricao?: string },
  ): Promise<{ anexado: true; nome: string }> {
    const arquivo = lerDataUrl(dados.arquivo);
    conferirArquivo(
      arquivo,
      TIPOS_DE_NOTA,
      LIMITE_DA_NOTA,
      'A nota entra como PDF ou imagem.',
    );

    const nome = nomeDoAnexo(dados.nome, arquivo.tipo);
    await this.ixc.upload(
      'fn_apagar_arquivos',
      'arquivo',
      { nome, tipo: arquivo.tipo, conteudo: arquivo.conteudo },
      {
        id_apagar: String(idFnApagar),
        // A descrição é o que aparece na lista de arquivos do título no IXC.
        descricao: (dados.descricao?.trim() || 'Nota').slice(0, 100),
      },
    );

    this.logger.log(
      `Nota "${nome}" (${emMegabytes(arquivo.conteudo.length)}) anexada ao ` +
        `título ${idFnApagar} no IXC.`,
    );
    return { anexado: true, nome };
  }

  /** As despesas que não chegaram ao IXC, para a tela poder mostrá-las. */
  naoEnviadas() {
    return this.contasPagar.despesasNaoEnviadas();
  }

  async lancar(
    dto: CriarDespesaDto,
    usuarioId?: string,
    usuarioNome?: string,
  ): Promise<DespesaLancada> {
    const hoje = hojeUtc();
    const emissao = dto.dataEmissao ? dataUtc(dto.dataEmissao) : hoje;

    // Conferido antes de ir ao IXC: um veículo que não existe mais (apagado em
    // outra aba) viraria uma conta lançada lá e sem vínculo aqui, em silêncio.
    if (dto.veiculoId) {
      const veiculo = await this.prisma.veiculo.findUnique({
        where: { id: dto.veiculoId },
        select: { id: true },
      });
      if (!veiculo) {
        throw new BadRequestException(
          'O veículo escolhido não existe mais. Escolha outro — nada foi lançado.',
        );
      }
    }

    /** O que é igual em todas as parcelas. */
    const comum = {
      idFornecedorIxc: dto.idFornecedorIxc,
      fornecedorNome: dto.fornecedorNome.trim(),
      dataEmissao: emissao,
      contaContabil: dto.contaContabil,
      contaPagamento: dto.contaPagamento,
      tipoPagamentoIxc: dto.tipoPagamento,
      numeroNota: dto.numeroNota,
      chavePix: dto.chavePix,
      tipoChavePix: dto.tipoChavePix,
      veiculoId: dto.veiculoId ?? null,
    };

    let lancada: DespesaLancada;
    if (!dto.parcelas?.length) {
      const conta = await this.contasPagar.criarDespesa(
        {
          ...comum,
          valor: dto.valor,
          dataVencimento: dto.dataVencimento ? dataUtc(dto.dataVencimento) : hoje,
          observacao: dto.observacao.trim(),
          codigoBarras: dto.codigoBarras,
          documento: dto.documento,
        },
        usuarioId,
      );

      lancada = {
        conta,
        contas: [conta],
        avisoCategoria: await this.etiquetar(
          conta,
          dto.categoriaId ?? null,
          usuarioId,
        ),
        baixa: null,
      };
    } else {
      lancada = await this.lancarParcelas(dto, comum, usuarioId);
    }

    // A baixa vem por último e nunca derruba o lançamento: a conta já existe no
    // IXC a esta altura, e desfazê-la para "cancelar" a baixa que falhou
    // deixaria o pior dos dois mundos — nada registrado aqui e um título órfão
    // lá. Não dando, quem lançou recebe o aviso e paga pela lista, onde o botão
    // faz exatamente esta mesma chamada.
    if (!dto.jaPaga) return lancada;

    return {
      ...lancada,
      baixa: await this.darPorPaga(lancada.contas, dto, usuarioNome),
    };
  }

  /**
   * Dá por pagas as contas que acabaram de ser criadas — aprovação na auditoria
   * e baixa no IXC, na data em que o dinheiro saiu de fato.
   *
   * É o caminho de quem pagou o boleto pelo aplicativo do banco e só depois veio
   * lançar. Sem isto o lançamento nasce em aberto, alguém tem de lembrar de
   * voltar para aprová-lo e baixá-lo, e enquanto isso a conta fica na fila de
   * pagamento como se ainda devesse — que é como o mesmo dinheiro sai duas
   * vezes.
   *
   * Parcelado, todas as parcelas são baixadas: quem marca "já foi paga" num
   * lançamento parcelado está registrando um acerto que já saiu inteiro.
   */
  private async darPorPaga(
    contas: ContaPagar[],
    dto: CriarDespesaDto,
    usuarioNome?: string,
  ): Promise<BaixaDoLancamento> {
    const data =
      dto.dataPagamento ??
      dto.dataVencimento ??
      new Date().toISOString().slice(0, 10);

    const baixa: BaixaDoLancamento = {
      pagas: 0,
      tentadas: contas.length,
      valor: 0,
      data,
      avisos: [],
    };

    for (const [i, conta] of contas.entries()) {
      const comoChamar =
        contas.length > 1 ? `A parcela ${i + 1} de ${contas.length}` : 'A conta';

      if (!conta.idFnApagarIxc) {
        baixa.avisos.push(
          `${comoChamar} não recebeu número do IXC, então não deu para dá-la ` +
            'por paga. Ela continua em aberto lá.',
        );
        continue;
      }

      try {
        const r = await this.pagamentos.pagar(
          conta.idFnApagarIxc,
          {
            contaPagamento: dto.contaPagamento,
            data,
            // Sem histórico próprio: quem monta é a baixa, no formato do
            // IXC ("Pag. Fulano - doc.: 9"). O texto que ia aqui — "Pago
            // antes do lançamento — <observação>" — não é o que o IXC
            // escreve, e um pagamento feito daqui tem de ser indistinguível
            // de um feito na tela dele. A observação já está no título.
            // O dinheiro saiu antes de o título existir: não há pagamento do
            // banco a esperar, nem na conta que ele costuma pagar.
            jaSaiu: true,
          },
          usuarioNome,
        );

        if (r.paga) {
          baixa.pagas += 1;
          baixa.valor += r.valor;
        } else {
          baixa.avisos.push(
            `${comoChamar} foi aprovada no IXC, mas ele não a deu por paga. ` +
              'Confira por lá antes de considerar essa conta quitada.',
          );
        }
        baixa.avisos.push(...r.avisos.map((a) => `${comoChamar}: ${a}`));
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Conta ${conta.id} foi lançada, mas a baixa não saiu: ${motivo}`,
        );
        baixa.avisos.push(
          `${comoChamar} foi lançada no IXC, mas não ficou paga (${motivo}). ` +
            'Pague-a pela lista de contas em aberto.',
        );
      }
    }

    this.logger.log(
      `Lançamento já pago: ${baixa.pagas}/${baixa.tentadas} conta(s) baixadas ` +
        `no IXC em ${data}.`,
    );
    return baixa;
  }

  /**
   * A nota em vezes: uma conta a pagar por parcela no IXC.
   *
   * As parcelas vão uma a uma, e o que já entrou fica de pé se a seguinte
   * falhar. Desfazer as anteriores seria pior: elas já existem no IXC, e o
   * conserto de "faltou a parcela 4" é lançar a 4 — enquanto o de "sumiram as
   * três primeiras" é conferir seis registros do outro lado.
   */
  private async lancarParcelas(
    dto: CriarDespesaDto,
    comum: Record<string, unknown>,
    usuarioId?: string,
  ): Promise<DespesaLancada> {
    const parcelas = dto.parcelas!;
    const criadas: ContaPagar[] = [];
    const avisos: string[] = [];

    for (const [i, parcela] of parcelas.entries()) {
      // "3/6" na observação é o que permite reconhecer a parcela na lista do
      // IXC, onde todas aparecem com o mesmo fornecedor e o mesmo texto. Num
      // consórcio já em andamento a numeração vem pronta da tela, porque ali a
      // primeira a lançar pode ser a 13 de 120.
      const numero = parcela.rotulo || `${i + 1}/${parcelas.length}`;
      const observacao = `${dto.observacao.trim()} (${numero})`.slice(0, 500);

      try {
        const conta = await this.contasPagar.criarDespesa(
          {
            ...(comum as Parameters<
              typeof this.contasPagar.criarDespesa
            >[0]),
            valor: parcela.valor,
            dataVencimento: dataUtc(parcela.dataVencimento),
            observacao,
            codigoBarras: parcela.codigoBarras ?? null,
            documento: parcela.documento ?? dto.documento ?? null,
          },
          usuarioId,
        );
        criadas.push(conta);

        const aviso = await this.etiquetar(
          conta,
          dto.categoriaId ?? null,
          usuarioId,
        );
        if (aviso) avisos.push(`Parcela ${i + 1}: ${aviso}`);
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Parcela ${i + 1}/${parcelas.length} não foi criada: ${motivo}`,
        );
        avisos.push(
          `A parcela ${i + 1} de ${parcelas.length} não foi criada (${motivo}). ` +
            `As ${criadas.length} anteriores já estão no IXC — lance esta ` +
            'de novo sozinha.',
        );
        break;
      }
    }

    if (criadas.length === 0) {
      throw new BadRequestException(
        avisos[0] ?? 'Nenhuma parcela pôde ser criada.',
      );
    }

    return {
      conta: criadas[0],
      contas: criadas,
      avisoCategoria: avisos.length ? avisos.join(' ') : null,
      baixa: null,
    };
  }

  /**
   * A etiqueta só pode ser gravada depois que o IXC devolve o número do título
   * — é por ele que a classificação se liga ao débito, e ele não existe antes
   * do envio.
   *
   * Falhar aqui não derruba o lançamento: a conta já está no IXC e apagá-la
   * para "desfazer" seria arriscar deixar o registro de lá vivo e o daqui não.
   * Quem lançou recebe o aviso e classifica pela lista, em dois cliques.
   */
  private async etiquetar(
    conta: ContaPagar,
    categoriaId: string | null,
    usuarioId?: string,
  ): Promise<string | null> {
    if (!categoriaId) return null;

    if (!conta.idFnApagarIxc) {
      return (
        'A conta não recebeu número do IXC, então a categoria não pôde ser ' +
        'gravada. Assim que o envio for refeito, classifique pela lista.'
      );
    }

    try {
      await this.categorias.classificar(
        conta.idFnApagarIxc,
        categoriaId,
        usuarioId,
      );
      return null;
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Despesa ${conta.id} foi lançada, mas a categoria não ficou: ${motivo}`,
      );
      return `A conta foi lançada no IXC, mas a categoria não ficou (${motivo}). Escolha-a na lista.`;
    }
  }
}

/**
 * "AAAA-MM-DD" → meia-noite em UTC. As datas desta base são gravadas assim e
 * lidas assim na hora de virar "DD/MM/AAAA" para o IXC; converter pelo fuso
 * local faria a conta lançada de madrugada sair com a data do dia anterior.
 */
function dataUtc(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function hojeUtc(): Date {
  const agora = new Date();
  return new Date(
    Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()),
  );
}

/**
 * O que entra como nota de uma conta a pagar.
 *
 * Papel: cupom fotografado, nota digitalizada, print do comprovante. Planilha e
 * documento do Word ficam de fora — o que se anexa aqui é a prova do gasto, e
 * ela vem em imagem ou PDF.
 */
const TIPOS_DE_NOTA = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
]);

/**
 * Teto da nota. Menor que o do RH de propósito: aqui o arquivo ainda atravessa
 * o webservice do IXC, que é a parte lenta e a que costuma desistir.
 */
const LIMITE_DA_NOTA = 8 * 1024 * 1024;

/**
 * O nome com que o arquivo chega ao IXC.
 *
 * Print colado não tem nome nenhum, e um arquivo sem extensão no anexo do IXC
 * não abre em lugar nenhum: quem clica lá recebe um binário sem dono. Então o
 * nome sai daqui quando não veio de fora, e a extensão vem do tipo declarado no
 * próprio arquivo.
 */
function nomeDoAnexo(nome: string | undefined, tipo: string): string {
  const ext = extensaoDoTipo(tipo);
  const limpo = (nome ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9.\-_ ]/g, '')
    .trim()
    .slice(0, 80);

  if (!limpo) {
    const agora = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    return `nota-${agora}.${ext}`;
  }
  return limpo.toLowerCase().endsWith(`.${ext}`) ? limpo : `${limpo}.${ext}`;
}

/** O texto de um campo do IXC, ou nada quando ele vem vazio. */
function textoOuNull(valor: unknown): string | null {
  const s = String(valor ?? '').trim();
  return s || null;
}

/** Uma nota anexada a um título, como a aba "Arquivos" do IXC a lista. */
export interface NotaDoTitulo {
  id: number;
  descricao: string;
  /** "png", "pdf" — é o que decide como o navegador abre o arquivo. */
  extensao: string;
  data: string | null;
  usuario: string | null;
}

const TIPO_POR_EXTENSAO: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
};

/**
 * O primeiro campo da resposta que se pareça com um arquivo em base64.
 *
 * Texto longo, só com o alfabeto do base64 e de tamanho múltiplo de quatro. Um
 * id, uma data ou uma mensagem não passam por essa peneira; um arquivo de
 * verdade, sim.
 */
function acharBase64(resposta: Record<string, unknown>): string | null {
  for (const valor of Object.values(resposta)) {
    if (typeof valor !== 'string' || valor.length < 100) continue;
    const limpo = valor.includes(',') ? valor.slice(valor.indexOf(',') + 1) : valor;
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(limpo) && limpo.replace(/\s/g, '').length % 4 === 0) {
      return limpo;
    }
  }
  return null;
}
