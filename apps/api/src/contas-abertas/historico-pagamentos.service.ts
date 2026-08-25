import { Injectable, Logger } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BaixasDoIxcService,
  TETO_DE_BAIXAS_AVULSAS,
  type LeituraDeBaixas,
} from './baixas-do-ixc.service';
import { CategoriasService } from './categorias.service';
import { ContasAbertasService } from './contas-abertas.service';
import { CAMPOS_DE_BAIXA, STATUS_DE_PAGO } from './contas-abertas.mapper';
import {
  aplicarBaixa,
  mapPagamento,
  motivoDeNaoSerPagamento,
  ordenarPorPagamento,
  resumirPagamentos,
  type PagamentoFeito,
  type ResumoPagamentos,
} from './historico-pagamentos.mapper';

/** O período pedido, já em datas. */
export interface Periodo {
  de: Date;
  ate: Date;
}

/** O que a tela de histórico recebe de uma vez. */
export interface HistoricoPagamentosResposta {
  pagamentos: PagamentoFeito[];
  resumo: ResumoPagamentos;
  periodo: { de: Date; ate: Date };
  /** Quando a leitura foi feita — ela é de agora, não de um espelho */
  lidoEm: Date;
  /** Como a lista foi obtida, por extenso. Ver `comoFoiLido`. */
  comoFoiLido: string;
  /** O que não deu para completar, ou o que ficou de fora, sem derrubar a lista */
  avisos: string[];
}

/**
 * Quantos títulos a leitura aceita percorrer. Um provedor com anos de histórico
 * tem muito pagamento; o teto existe para um período largo não travar a tela — e
 * o aviso conta que houve corte, em vez de mostrar um total parcial como se
 * fosse o total.
 */
const TETO_DE_TITULOS = 4000;
const PAGINA = 500;

/** Por quanto tempo vale o que se descobriu sobre a coluna da baixa. */
const VALIDADE_DA_SONDA_MS = 30 * 60 * 1000;

/**
 * Quanto tempo depois do dinheiro sair uma baixa ainda costuma ser lançada.
 *
 * Não é um limite de nada: é o quanto a leitura das baixas recua para já trazer
 * a linha dos títulos lançados com atraso. O que passar disso ainda é perguntado
 * um a um — só que aí são poucos.
 */
const MARGEM_DE_LANCAMENTO_DIAS = 90;

/**
 * Como esta base do IXC responde a um filtro por data de baixa: em que coluna a
 * data mora e em que formato ela precisa ser mandada.
 */
interface FiltroDeBaixa {
  campo: string;
  formato: 'iso' | 'br';
}

/**
 * O histórico do que a empresa já pagou, lido do IXC na hora.
 *
 * Sai da mesma tabela da tela de contas em aberto (`fn_apagar`) — no IXC o
 * título não muda de lugar quando é pago, ele ganha a baixa. A diferença está no
 * tamanho do problema: contas em aberto são centenas e cabem numa leitura só,
 * enquanto pagamento feito só acumula. Nesta base são 34 mil títulos pagos, e
 * puxar tudo para mostrar um mês seria uma tela que nunca abre.
 *
 * O painel já responde "quanto saiu este mês", num número só
 * (`ContasAbertasService.pagasNoMes`). Aqui é a lista por trás daquele número:
 * título por título, com o dia, o caixa, e o que no registro do IXC não fecha.
 *
 * Por isso aqui o período não é enfeite de filtro: é o que torna a leitura
 * possível. O IXC é consultado pela data da baixa, em ordem crescente, e a
 * paginação **para** quando os registros passam do fim do período — a janela
 * pedida é lida quase exata, não importa quantos anos de histórico existam
 * antes ou depois dela.
 */
@Injectable()
export class HistoricoPagamentosService {
  private readonly logger = new Logger(HistoricoPagamentosService.name);

  /**
   * O que a sonda descobriu. `null` guardado = sondou e nenhuma coluna
   * respondeu; aí a leitura vai pelo caminho lento, sem sondar de novo a cada
   * abertura de tela.
   */
  private filtro: { em: number; achado: FiltroDeBaixa | null } | null = null;

  /** Nome dos caixas por código, guardado junto com a leitura da tela. */
  private caixas: { em: number; nomes: Map<number, string> } | null = null;

  constructor(
    private readonly ixc: IxcClient,
    private readonly prisma: PrismaService,
    private readonly categorias: CategoriasService,
    // O título sabe que foi pago e em que dia isso foi *registrado*; quem sabe
    // em que dia o dinheiro saiu é a baixa. Sem ela, quem lança no dia seguinte
    // ao pagamento vê a tela acusar atraso de um pagamento feito no prazo.
    private readonly baixas: BaixasDoIxcService,
    // Os índices de nome (fornecedor, plano de contas) e a lista de caixas vêm
    // de lá de propósito: é o serviço que sabe em que tabela desta base cada
    // cadastro mora — `planejamento_analitico` para o plano de contas, por
    // exemplo, que não é o nome documentado. Uma cópia disso aqui erraria o
    // nome da tabela e mostraria código no lugar de nome.
    private readonly contasAbertas: ContasAbertasService,
  ) {}

  async listar(periodo: Periodo): Promise<HistoricoPagamentosResposta> {
    const avisos: string[] = [];
    const lidoEm = new Date();

    const filtro = await this.filtroDeBaixa();
    const leitura = filtro
      ? await this.lerJanela(filtro, periodo)
      : await this.lerPorStatus();

    if (leitura.cortado) {
      avisos.push(
        `A leitura parou em ${TETO_DE_TITULOS} títulos. Há mais movimento no ` +
          'IXC do que cabe nesta tela — os totais abaixo são só do que veio. ' +
          'Escolha um período mais curto para ver o que falta.',
      );
    }

    /*
     * O dia em que o dinheiro saiu vem da baixa; o título só sabe o dia em que
     * ela foi registrada. É a diferença entre "pagou atrasado" e "lançou
     * atrasado", e a segunda não é problema de ninguém.
     *
     * A leitura começa antes do período de propósito. O título lançado dentro
     * dele pode ter sido pago antes, e é justamente esse o caso que se veio
     * consertar — sem a baixa dele no índice, cada um viraria uma pergunta
     * separada ao IXC, e dezenas de lançamentos atrasados num mês são dezenas
     * de idas e voltas numa abertura de tela. Uma janela mais larga custa uma
     * página a mais de leitura e responde por todos.
     */
    const baixas = await this.baixas.daJanela(
      recuar(periodo.de, MARGEM_DE_LANCAMENTO_DIAS),
      periodo.ate,
    );

    // Cada título que fica de fora é contado pelo motivo e pela coluna que
    // decidiu — a mesma disciplina da tela de contas em aberto, onde foi assim
    // que se descobriu que uma regra larga demais tinha engolido quatrocentos
    // títulos de verdade.
    const excluidos = new Map<string, number>();
    const pagamentos: PagamentoFeito[] = [];
    const contagem = { foraDoPeriodo: 0, mudaramDePeriodo: 0 };
    const idsLidos = new Set<number>();
    /** Baixado, mas sem linha de baixa na janela lida: precisa ser perguntado. */
    const semParNaJanela: PagamentoFeito[] = [];

    for (const raw of leitura.brutos) {
      const fora = motivoDeNaoSerPagamento(raw);
      if (fora) {
        excluidos.set(
          `${fora.motivo}|${fora.campo}`,
          (excluidos.get(`${fora.motivo}|${fora.campo}`) ?? 0) + 1,
        );
        continue;
      }

      const pagamento = mapPagamento(raw);
      if (!pagamento) continue;
      idsLidos.add(pagamento.idFnApagar);

      /*
       * O título que já traz o dia do débito não precisa da linha de baixa: o
       * dia que alguém informou ao baixar está nele, e é esse. Poupa a leitura
       * das baixas para quem realmente depende dela.
       */
      if (pagamento.fonteDaData === 'debito') {
        this.guardar(pagamento, periodo, pagamentos, contagem);
        continue;
      }

      const baixa = baixas.porTitulo.get(pagamento.idFnApagar);
      if (baixa) {
        aplicarBaixa(pagamento, baixa);
        this.guardar(pagamento, periodo, pagamentos, contagem);
        continue;
      }

      /*
       * Título baixado cuja linha de baixa a janela não trouxe. São dois casos
       * que só uma pergunta separa: ou o dinheiro saiu antes do que a janela
       * alcança — o lançamento muito atrasado —, ou a listagem não devolveu a
       * linha. No primeiro, o pagamento é de outro período e não pode ser
       * contado neste; no segundo, ele é daqui e sumiria se fosse descartado.
       * Chutar erraria metade.
       */
      if (baixas.disponivel) {
        semParNaJanela.push(pagamento);
        continue;
      }

      // Sem as baixas, resta o dia do registro — que é o que esta tela mostrava
      // antes, e a ficha de cada pagamento diz que é ele.
      this.guardar(pagamento, periodo, pagamentos, contagem);
    }

    const semDataDoDinheiro = await this.perguntarBaixaUmAUm(
      semParNaJanela,
      periodo,
      pagamentos,
      contagem,
    );

    await this.buscarPagosForaDaJanela(
      baixas,
      idsLidos,
      periodo,
      pagamentos,
      contagem,
      avisos,
    );

    avisos.push(...explicarExclusoes(excluidos));
    avisos.push(
      ...explicarDatas({
        baixas,
        mudaramDePeriodo: contagem.mudaramDePeriodo,
        semDataDoDinheiro,
      }),
    );

    // Muito registro fora da janela é o sinal de que o IXC não aplicou o
    // filtro: em vez de mostrar um número silenciosamente errado, a tela conta
    // que a conferência aconteceu deste lado.
    if (
      contagem.foraDoPeriodo > pagamentos.length &&
      contagem.foraDoPeriodo > 20
    ) {
      avisos.push(
        `${contagem.foraDoPeriodo} pagamento(s) vieram do IXC fora do período pedido e ` +
          'foram descartados aqui. Provavelmente o filtro por data não está ' +
          'sendo aplicado do lado do IXC — os totais abaixo são só do período, ' +
          'mas a leitura está trazendo mais do que precisa.',
      );
    }

    await this.completarNomes(pagamentos, avisos);
    await this.aplicarClassificacoes(pagamentos);
    await this.marcarOrigemNaFolha(pagamentos);

    return {
      pagamentos: ordenarPorPagamento(pagamentos),
      resumo: resumirPagamentos(pagamentos),
      periodo,
      lidoEm,
      comoFoiLido: `${leitura.como} ${baixas.como}`,
      avisos,
    };
  }

  /**
   * Põe o pagamento na lista, ou conta por que ele não entrou.
   *
   * Os dois motivos de ficar de fora são diferentes e não podem virar um número
   * só. Data do registro fora do período é sinal de filtro que o IXC ignorou —
   * defeito de leitura. Data do registro dentro e data do dinheiro fora é o
   * lançamento atrasado funcionando como deve: o pagamento é de outro período e
   * é lá que ele aparece. Somados, o primeiro se esconderia atrás do segundo.
   */
  private guardar(
    pagamento: PagamentoFeito,
    periodo: Periodo,
    pagamentos: PagamentoFeito[],
    contagem: { foraDoPeriodo: number; mudaramDePeriodo: number },
  ): void {
    // O período é conferido aqui, sempre. Base que ignore um `qtype` que não
    // conhece devolve a tabela inteira, e um histórico com pagamento de outro
    // mês no meio mente sobre quanto saiu do caixa no período.
    if (dentroDoPeriodo(pagamento.pagoEm, periodo)) {
      pagamentos.push(pagamento);
      return;
    }
    if (dentroDoPeriodo(pagamento.registradoEm, periodo)) {
      contagem.mudaramDePeriodo += 1;
      return;
    }
    contagem.foraDoPeriodo += 1;
  }

  /**
   * Pergunta ao IXC, título por título, a baixa dos que ficaram sem par.
   *
   * Devolve quantos continuaram sem resposta — esses ficam com a data do
   * registro, e a ficha deles diz isso. É a única saída honesta: descartá-los
   * sumiria com um pagamento que existe, e datá-los pelo registro sem avisar
   * repetiria o erro que esta leitura veio consertar.
   */
  private async perguntarBaixaUmAUm(
    semPar: PagamentoFeito[],
    periodo: Periodo,
    pagamentos: PagamentoFeito[],
    contagem: { foraDoPeriodo: number; mudaramDePeriodo: number },
  ): Promise<number> {
    let semResposta = 0;

    for (const [i, pagamento] of semPar.entries()) {
      const baixa =
        i < TETO_DE_BAIXAS_AVULSAS
          ? await this.baixas.doTitulo(pagamento.idFnApagar)
          : null;

      if (baixa) {
        aplicarBaixa(pagamento, baixa);
      } else {
        semResposta += 1;
      }
      this.guardar(pagamento, periodo, pagamentos, contagem);
    }

    return semResposta;
  }

  /**
   * Busca os títulos que foram pagos no período mas registrados fora dele.
   *
   * São o outro lado do lançamento atrasado: a baixa é do dia 30 de julho e o
   * registro, do dia 5 de agosto. A leitura por data do título procura julho e
   * não acha esse registro; sem esta busca o pagamento sumiria de julho — e de
   * agosto ele já sai, porque o dinheiro não saiu em agosto. Pagamento que não
   * aparece em período nenhum é o pior resultado possível numa tela de
   * conferência: ninguém procura o que não está em lugar algum.
   */
  private async buscarPagosForaDaJanela(
    baixas: LeituraDeBaixas,
    idsLidos: Set<number>,
    periodo: Periodo,
    pagamentos: PagamentoFeito[],
    contagem: { foraDoPeriodo: number; mudaramDePeriodo: number },
    avisos: string[],
  ): Promise<void> {
    if (!baixas.disponivel) return;

    // Só as baixas do período: a leitura recua antes dele para achar a linha
    // dos títulos lançados com atraso, e ir buscar todo título de três meses
    // atrás que a janela não trouxe seria puxar meio histórico para descartar.
    const faltantes = [...baixas.porTitulo.values()].filter(
      (b) => !idsLidos.has(b.idFnApagar) && dentroDoPeriodo(b.data, periodo),
    );
    if (faltantes.length === 0) return;

    for (const baixa of faltantes.slice(0, TETO_DE_BAIXAS_AVULSAS)) {
      const raw = await this.ixc
        .getById<Record<string, unknown>>(
          'fn_apagar',
          'fn_apagar.id',
          baixa.idFnApagar,
        )
        .catch(() => null);
      if (!raw) continue;

      // O título vem do mesmo filtro que o resto da tela: baixa estornada não
      // é dinheiro que saiu, mesmo tendo linha de pagamento.
      if (motivoDeNaoSerPagamento(raw)) continue;

      const pagamento = mapPagamento(raw);
      if (!pagamento) continue;

      aplicarBaixa(pagamento, baixa);
      this.guardar(pagamento, periodo, pagamentos, contagem);
    }

    if (faltantes.length > TETO_DE_BAIXAS_AVULSAS) {
      avisos.push(
        `${faltantes.length - TETO_DE_BAIXAS_AVULSAS} pagamento(s) deste ` +
          'período foram registrados no IXC depois dele e não couberam nesta ' +
          'leitura. Eles existem lá — escolha um período que alcance o dia em ' +
          'que foram registrados para vê-los.',
      );
    }
  }

  /**
   * Lê a janela do período pela coluna da baixa, em ordem crescente, parando na
   * primeira página que já passou do fim do período.
   *
   * A ordem crescente é o que faz isto funcionar: pedindo "baixa >= início" e
   * lendo do mais antigo para o mais novo, a janela pedida chega nas primeiras
   * páginas e o resto do histórico nem é buscado. Fosse decrescente, pedir
   * janeiro numa base que pagou coisas até hoje leria tudo de hoje até janeiro
   * para jogar quase tudo fora.
   */
  private async lerJanela(
    filtro: FiltroDeBaixa,
    periodo: Periodo,
  ): Promise<Leitura> {
    const brutos: Array<Record<string, unknown>> = [];
    let pagina = 1;
    let cortado = false;

    while (brutos.length < TETO_DE_TITULOS) {
      const res = await this.ixc.list<Record<string, unknown>>('fn_apagar', {
        qtype: `fn_apagar.${filtro.campo}`,
        query: formatarData(periodo.de, filtro.formato),
        oper: '>=',
        sortname: `fn_apagar.${filtro.campo}`,
        sortorder: 'asc',
        page: pagina,
        rp: PAGINA,
      });

      if (res.registros.length === 0) break;
      brutos.push(...res.registros);

      // A página que já passou do fim do período encerra a leitura: o que vem
      // depois dela é mais recente ainda.
      if (paginaPassouDoPeriodo(res.registros, filtro.campo, periodo)) break;
      if (res.registros.length < PAGINA) break;

      pagina += 1;
      if (brutos.length >= TETO_DE_TITULOS) cortado = true;
    }

    return {
      brutos,
      cortado,
      como:
        `Lido do IXC pela coluna "${filtro.campo}", filtrando a data da baixa ` +
        `no período pedido.`,
    };
  }

  /**
   * O caminho lento, para quando nenhuma coluna de data aceita filtro nesta
   * base: pede os títulos por status e o período é aplicado deste lado.
   *
   * Os status de pago (`STATUS_DE_PAGO`, que nesta base é "F") vêm primeiro. O
   * "A" entra depois porque aqui o status fica parado em aberto mesmo em título
   * já baixado — foi esse status preso que fez quatro títulos de 2023
   * aparecerem como vencidos na tela de contas a pagar. Ler só o status de pago
   * perderia justamente os pagamentos que o IXC não soube marcar.
   */
  private async lerPorStatus(): Promise<Leitura> {
    const brutos: Array<Record<string, unknown>> = [];
    let cortado = false;

    for (const status of [...STATUS_DE_PAGO, 'A'] as const) {
      const restante = TETO_DE_TITULOS - brutos.length;
      if (restante <= 0) {
        cortado = true;
        break;
      }

      const parte = await this.ixc.listAll<Record<string, unknown>>(
        'fn_apagar',
        {
          qtype: 'fn_apagar.status',
          query: status,
          oper: '=',
          sortname: 'fn_apagar.id',
          sortorder: 'desc',
        },
        { pageSize: PAGINA, maxPages: Math.ceil(restante / PAGINA) },
      );
      brutos.push(...parte);
      if (parte.length >= restante) cortado = true;
    }

    return {
      brutos,
      cortado,
      como:
        'Lido do IXC por status (nenhuma coluna de data da baixa aceitou ' +
        'filtro nesta base), e o período foi aplicado aqui. É a leitura mais ' +
        'pesada: períodos antigos podem não caber.',
    };
  }

  /**
   * Descobre em que coluna esta base guarda a data da baixa e em que formato
   * ela aceita comparação.
   *
   * Nada disso está fechado na documentação do webservice, e chutar tem custo
   * dos dois lados: coluna errada devolve zero pagamento (a tela diria "nada
   * foi pago", que é mentira), e formato errado pode devolver a tabela inteira.
   * Então se pergunta ao próprio IXC, com consultas de um registro só: para
   * cada coluna conhecida, em cada formato, quantos títulos ele diz existir com
   * baixa a partir de uma data antiga. Vence quem devolve o maior total que
   * ainda seja menor que a tabela inteira — total igual ao da tabela é filtro
   * ignorado, não coluna encontrada.
   */
  private async filtroDeBaixa(): Promise<FiltroDeBaixa | null> {
    if (this.filtro && Date.now() - this.filtro.em < VALIDADE_DA_SONDA_MS) {
      return this.filtro.achado;
    }

    const total = await this.totalDeTitulos();
    // Data velha o suficiente para pegar qualquer histórico: o que se mede aqui
    // é se o filtro funciona, não quanto foi pago.
    const marco = new Date(Date.UTC(2000, 0, 1));

    let melhor: { filtro: FiltroDeBaixa; total: number } | null = null;
    for (const campo of CAMPOS_DE_BAIXA) {
      for (const formato of ['iso', 'br'] as const) {
        const quantos = await this.sondar(campo, formato, marco);
        if (quantos === null) continue;
        // Filtro ignorado devolve a tabela inteira; não é coluna encontrada.
        if (total > 0 && quantos >= total) continue;
        if (quantos > 0 && (!melhor || quantos > melhor.total)) {
          melhor = { filtro: { campo, formato }, total: quantos };
        }
      }
      // Achou pela primeira coluna conhecida: é a mais provável e não vale
      // gastar mais consultas confirmando o óbvio.
      if (melhor) break;
    }

    if (melhor) {
      this.logger.log(
        `Baixa filtrável por "${melhor.filtro.campo}" (formato ` +
          `${melhor.filtro.formato}): ${melhor.total} título(s) baixados no IXC.`,
      );
    } else {
      this.logger.warn(
        'Nenhuma coluna de data da baixa aceitou filtro nesta base — o ' +
          'histórico vai ser lido por status, o que é mais pesado.',
      );
    }

    this.filtro = { em: Date.now(), achado: melhor?.filtro ?? null };
    return this.filtro.achado;
  }

  /** Quantos títulos o IXC diz existir com baixa a partir de `desde`. */
  private async sondar(
    campo: string,
    formato: 'iso' | 'br',
    desde: Date,
  ): Promise<number | null> {
    try {
      const res = await this.ixc.list('fn_apagar', {
        qtype: `fn_apagar.${campo}`,
        query: formatarData(desde, formato),
        oper: '>=',
        rp: 1,
      });
      return res.total;
    } catch {
      // Coluna que esta base não tem, ou formato que ela recusa: o IXC responde
      // com erro e a sonda passa para a tentativa seguinte.
      return null;
    }
  }

  /** O tamanho da tabela, para reconhecer um filtro que foi ignorado. */
  private async totalDeTitulos(): Promise<number> {
    try {
      const res = await this.ixc.list('fn_apagar', {
        qtype: 'fn_apagar.id',
        query: '0',
        oper: '>',
        rp: 1,
      });
      return res.total;
    } catch {
      return 0;
    }
  }

  /**
   * Preenche o nome de quem recebeu, o da conta de despesa e o do caixa de onde
   * o dinheiro saiu.
   *
   * Nenhum dos três é essencial: sem eles a tela mostra o código, e é melhor um
   * histórico com códigos do que histórico nenhum. Por isso cada falha vira
   * aviso, não erro.
   */
  private async completarNomes(
    pagamentos: PagamentoFeito[],
    avisos: string[],
  ): Promise<void> {
    if (pagamentos.length === 0) return;

    const semNome = pagamentos.filter(
      (p) => !p.fornecedor.nome && p.fornecedor.id !== null,
    );
    if (semNome.length > 0) {
      try {
        const nomes = await this.contasAbertas.nomesDosFornecedores();
        for (const p of semNome) {
          p.fornecedor.nome =
            nomes.get(p.fornecedor.id!) ?? `Fornecedor ${p.fornecedor.id}`;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Não deu para ler os fornecedores: ${message}`);
        avisos.push(
          'Não consegui ler o cadastro de fornecedores do IXC, então alguns ' +
            'pagamentos aparecem sem o nome de quem recebeu.',
        );
      }
    }

    const semCategoria = pagamentos.filter(
      (p) => !p.categoria.nome && p.categoria.id !== null,
    );
    if (semCategoria.length > 0) {
      const nomes = await this.contasAbertas.nomesDasContasDeDespesa();
      for (const p of semCategoria) {
        p.categoria.nome = nomes.get(p.categoria.id!) ?? null;
      }
    }

    const semCaixa = pagamentos.filter(
      (p) => !p.caixa.nome && p.caixa.id !== null,
    );
    if (semCaixa.length > 0) {
      const nomes = await this.nomesDosCaixas();
      for (const p of semCaixa) {
        p.caixa.nome = nomes.get(p.caixa.id!) ?? null;
      }
    }
  }

  /**
   * Nome das contas de onde o dinheiro sai — "Sicoob", "CX - Werick" —, para a
   * ficha dizer de onde saiu em vez de mostrar um código.
   *
   * Falha para dentro: sem o nome a tela mostra "caixa 27", o que é feio mas
   * verdadeiro, e não vale derrubar um histórico de pagamento por um rótulo.
   */
  private async nomesDosCaixas(): Promise<Map<number, string>> {
    if (this.caixas && Date.now() - this.caixas.em < VALIDADE_DA_SONDA_MS) {
      return this.caixas.nomes;
    }

    const nomes = new Map<number, string>();
    try {
      for (const conta of await this.contasAbertas.contasDePagamento()) {
        nomes.set(conta.id, conta.nome);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Não deu para listar as contas de pagamento: ${message}`);
    }

    this.caixas = { em: Date.now(), nomes };
    return nomes;
  }

  /** Cola em cada pagamento a etiqueta de "com o que se gastou", que é nossa. */
  private async aplicarClassificacoes(
    pagamentos: PagamentoFeito[],
  ): Promise<void> {
    if (pagamentos.length === 0) return;

    const etiquetas = await this.categorias.dosTitulos(
      pagamentos.map((p) => p.idFnApagar),
    );
    for (const p of pagamentos) {
      const categoria = etiquetas.get(p.idFnApagar);
      if (categoria) {
        p.classificacao = categoria;
      }
    }
  }

  /**
   * Marca os pagamentos que nasceram aqui — salário, diária, avulso. É o que
   * deixa conferir na mesma tela o pagamento da folha e o do fornecedor, sem
   * ninguém achar que a folha foi cobrada duas vezes.
   */
  private async marcarOrigemNaFolha(
    pagamentos: PagamentoFeito[],
  ): Promise<void> {
    const ids = pagamentos.map((p) => p.idFnApagar);
    if (ids.length === 0) return;

    const nossas = await this.prisma.contaPagar.findMany({
      where: { idFnApagarIxc: { in: ids } },
      select: {
        id: true,
        idFnApagarIxc: true,
        tipo: true,
        funcionario: { select: { nome: true } },
        diarista: { select: { nome: true } },
        beneficiarioAvulso: { select: { nome: true } },
      },
    });

    const porFnApagar = new Map(nossas.map((c) => [c.idFnApagarIxc, c]));
    for (const p of pagamentos) {
      const nossa = porFnApagar.get(p.idFnApagar);
      if (!nossa) continue;
      p.origem = {
        tipo: nossa.tipo,
        contaId: nossa.id,
        beneficiario:
          nossa.funcionario?.nome ??
          nossa.diarista?.nome ??
          nossa.beneficiarioAvulso?.nome ??
          null,
      };
    }
  }
}

/** O resultado cru de uma leitura, com o que houve de anormal nela. */
interface Leitura {
  brutos: Array<Record<string, unknown>>;
  /** A leitura bateu no teto e há mais movimento no IXC do que veio. */
  cortado: boolean;
  como: string;
}

/**
 * Conta em texto o que ficou de fora, por motivo e por coluna.
 *
 * "Não pago" não vira aviso: título em aberto não estar no histórico de
 * pagamentos é o esperado, e dizer isso a cada leitura seria ruído. Cancelado e
 * sem data viram, porque é neles que um erro se esconde — um pagamento de
 * verdade lido como cancelado desaparece do histórico sem deixar rastro, e é
 * exatamente o tipo de sumiço que já custou caro na tela de contas em aberto.
 */
function explicarExclusoes(excluidos: Map<string, number>): string[] {
  const avisos: string[] = [];

  for (const [chave, quantidade] of excluidos) {
    const [motivo, campo] = chave.split('|');
    if (motivo === 'nao-pago') continue;

    if (motivo === 'cancelado') {
      avisos.push(
        `${quantidade} título(s) com baixa no IXC ficaram de fora por estarem ` +
          `cancelados (coluna "${campo}") — pagamento estornado não é dinheiro ` +
          'que saiu. Se algum deles foi pago de verdade, é essa coluna que está ' +
          'sendo lida errado.',
      );
    } else if (motivo === 'sem-data') {
      avisos.push(
        `${quantidade} título(s) estão com status "pago" no IXC mas sem data de ` +
          'baixa em nenhuma coluna conhecida. Sem o dia não há como colocá-los ' +
          'no período, então não aparecem na lista — e também não estão nas ' +
          'contas em aberto, por estarem pagos.',
      );
    }
  }

  return avisos;
}

/**
 * Conta em texto de onde vieram as datas desta leitura.
 *
 * A tela mostra um dia para cada pagamento e não tem como mostrar dois. Quando
 * esse dia não é o do dinheiro — porque a baixa não pôde ser lida —, dizê-lo é o
 * que impede alguém de cobrar de um fornecedor um atraso que foi do lançamento.
 */
function explicarDatas(p: {
  baixas: LeituraDeBaixas;
  mudaramDePeriodo: number;
  semDataDoDinheiro: number;
}): string[] {
  const avisos: string[] = [];

  if (!p.baixas.disponivel) {
    avisos.push(
      'A data mostrada em cada pagamento é o dia em que a baixa foi registrada ' +
        'no IXC, não necessariamente o dia em que o dinheiro saiu: não consegui ' +
        'ler as baixas desta base. Conta paga num dia e lançada em outro aparece ' +
        'aqui com atraso que é do lançamento, não do pagamento — confira na aba ' +
        '"Pagamentos" do título, no IXC.',
    );
    return avisos;
  }

  if (p.baixas.cortado) {
    avisos.push(
      `A leitura das baixas parou em ${p.baixas.lidas} linhas. Alguns ` +
        'pagamentos deste período podem estar com a data do registro em vez da ' +
        'do dia em que o dinheiro saiu — escolha um período mais curto.',
    );
  }

  if (p.semDataDoDinheiro > 0) {
    avisos.push(
      `${p.semDataDoDinheiro} pagamento(s) estão com a data em que a baixa foi ` +
        'registrada: não achei a linha de baixa deles no IXC. Na ficha de cada ' +
        'um está dito de onde a data veio.',
    );
  }

  if (p.mudaramDePeriodo > 0) {
    avisos.push(
      `${p.mudaramDePeriodo} título(s) tiveram a baixa registrada neste ` +
        'período, mas o dinheiro saiu antes dele — eles aparecem no período em ' +
        'que saíram, não neste.',
    );
  }

  return avisos;
}

/** A data está dentro do período, contando por dia civil e incluindo as pontas. */
function dentroDoPeriodo(data: Date, periodo: Periodo): boolean {
  const dia = diaCivil(data);
  return dia >= diaCivil(periodo.de) && dia <= diaCivil(periodo.ate);
}

function diaCivil(data: Date): number {
  return Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());
}

/** A mesma data, tantos dias antes. */
function recuar(data: Date, dias: number): Date {
  return new Date(data.getTime() - dias * 86_400_000);
}

/**
 * Se esta página já passou do fim do período. Vindo em ordem crescente, basta
 * olhar a última linha: passou dela, o resto do histórico é mais recente ainda.
 *
 * Linha sem data legível não encerra nada — ela pode ser um registro estranho no
 * meio de uma página que ainda está dentro da janela.
 */
function paginaPassouDoPeriodo(
  registros: Array<Record<string, unknown>>,
  campo: string,
  periodo: Periodo,
): boolean {
  for (let i = registros.length - 1; i >= 0; i--) {
    const data = parseData(registros[i][campo]);
    if (data) return diaCivil(data) > diaCivil(periodo.ate);
  }
  return false;
}

/** Data crua do IXC, aceitando ISO e pt-BR, com ou sem hora. */
function parseData(valor: unknown): Date | null {
  const s = String(valor ?? '').trim();
  if (!s || s.startsWith('0000')) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));

  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return new Date(Date.UTC(+br[3], +br[2] - 1, +br[1]));

  return null;
}

/** A data no formato que a sonda descobriu que esta base aceita comparar. */
function formatarData(data: Date, formato: 'iso' | 'br'): string {
  const d = String(data.getUTCDate()).padStart(2, '0');
  const m = String(data.getUTCMonth() + 1).padStart(2, '0');
  const y = data.getUTCFullYear();
  return formato === 'iso' ? `${y}-${m}-${d}` : `${d}/${m}/${y}`;
}
