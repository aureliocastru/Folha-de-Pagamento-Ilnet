import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, TipoMovimentoDaRua } from '@prisma/client';
import { DespesasService } from '../contas-abertas/despesas.service';
import { PagamentosService } from '../contas-abertas/pagamentos.service';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { CaixaService, type LancamentoDoCaixa } from '../ixc/caixa.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A despesa que a prestação de contas lança: o que a pessoa foi comprar com o
 * dinheiro que levou.
 *
 * Sem ela o gasto fica sabido só aqui — a nota existe na gaveta e o financeiro
 * da empresa nunca soube que aquele dinheiro virou despesa.
 */
export interface DespesaDaPrestacao {
  /** Quem recebeu, entre os fornecedores que já existem no IXC. */
  idFornecedorIxc: number;
  fornecedorNome: string;
  /** O que foi comprado — vira a observação do título no IXC. */
  descricao: string;
  /**
   * Dia em que o dinheiro saiu (AAAA-MM-DD). Vazio = o dia da entrega.
   *
   * Quase sempre está no passado: quem levou dinheiro na segunda só senta para
   * prestar contas na sexta, e a saída no IXC tem de cair na segunda, ou o
   * caixa daquela semana não bate.
   */
  pagoEm?: string;
  categoriaId?: string | null;
  tipoPagamento?: string;
  contaContabil?: number;
}

/** Um lançamento do IXC junto do que a conferência guardou sobre ele. */
export interface LancamentoConferido extends LancamentoDoCaixa {
  conferido: boolean;
  conferidoEm: Date | null;
  /** Quantas fotos de nota há. As fotos em si vêm sob demanda. */
  qtdNotas: number;
  observacao: string | null;
}

/**
 * Bater o caixa do dinheiro em mãos.
 *
 * Os lançamentos são do IXC e continuam sendo: esta tela lê e nunca escreve
 * lá. O que nasce aqui é o que o IXC não tem onde guardar — o "já conferi
 * este", a foto da nota, e o dinheiro que saiu com alguém e não voltou.
 *
 * Esse último é o que fazia a conta não fechar no papel. O dinheiro que está
 * com o Jeferson saiu da gaveta e ainda não virou despesa: some da contagem
 * física sem aparecer em lugar nenhum. Enquanto não se declara quem está com
 * quanto, o caixa fecha errado, e por um valor que ninguém sabe explicar
 * depois.
 */
@Injectable()
export class FechamentoCaixaService {
  private readonly logger = new Logger(FechamentoCaixaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly caixa: CaixaService,
    private readonly config: ConfigFinanceiraService,
    private readonly despesas: DespesasService,
    private readonly pagamentos: PagamentosService,
  ) {}

  /** Os caixas do IXC, para escolher qual bater. */
  async listarCaixas() {
    const cfg = await this.config.obter();
    const { tabela, caixas } = await this.caixa.listarCaixas(
      cfg.caixaTabelaContas,
    );

    let emUso: number | null = null;
    try {
      emUso = await this.caixa.resolverCaixa(cfg);
    } catch {
      // Sem o caixa configurado a tela ainda serve: quem bate escolhe na lista.
      emUso = null;
    }

    return { tabela, caixas, emUso };
  }

  /** O que a descoberta achou no IXC — a primeira pergunta quando falha. */
  async diagnostico() {
    const cfg = await this.config.obter();
    return this.caixa.diagnostico(cfg);
  }

  async extrato(caixaId: number, de: string, ate: string) {
    const inicio = dataDoDia(de, 'inicial');
    /*
     * O período vai até o fim do último dia, e não até a meia-noite dele.
     *
     * `dataDoDia` devolve 00:00, que é o **começo** do dia. Usar isso como fim
     * fazia o recorte de hoje ser o intervalo vazio [00:00, 00:00]: uma saída
     * anotada às duas da tarde ficava de fora, e a gaveta não se mexia com ela
     * — o dinheiro tinha saído e a tela dizia que não. Só o que nasce com hora
     * zerada (os fechamentos, os acertos com data escolhida) escapava disso,
     * que é por que o defeito demorou a aparecer.
     */
    const fim = fimDoDia(dataDoDia(ate, 'final'));
    if (inicio > fim) {
      throw new BadRequestException('A data inicial é depois da final.');
    }

    const cfg = await this.config.obter();
    const { caixas } = await this.caixa.listarCaixas(cfg.caixaTabelaContas);
    const oCaixa = caixas.find((c) => c.id === caixaId);

    /*
     * De onde vem o saldo inicial.
     *
     * O webservice do IXC não devolve saldo de conta — o cadastro tem
     * `saldo_abertura`, do dia em que a conta nasceu, e mais nada. Somar a
     * história inteira a cada abertura de tela é a leitura que já derrubou esta
     * página com 502. Então o saldo se encadeia: cada fechamento guarda com
     * quanto o período fechou, e o seguinte começa dali. O primeiro de cada
     * caixa pergunta a quem está contando a gaveta.
     *
     * Quando o fechamento anterior foi contado, é a contagem que vale, e não a
     * conta. Dinheiro que existe na gaveta e não aparece na soma continuaria a
     * faltar em todos os períodos seguintes se o encadeamento seguisse o
     * calculado — a diferença tem de morrer no fechamento em que apareceu.
     */
    const anterior = await this.prisma.fechamentoCaixa.findFirst({
      where: { caixaId, ate: { lt: inicio } },
      orderBy: { ate: 'desc' },
    });
    const saldoInicial = anterior ? Number(saldoQueSegue(anterior)) : null;

    /*
     * A gaveta não se conta pelo recorte da tela.
     *
     * O saldo esperado é o dinheiro que deve estar lá agora — um fato do
     * caixa, não do filtro. Mas ele nascia da soma do período visível sobre o
     * saldo do último fechamento, e essas duas pontas nem sempre se encostam:
     * com o caixa fechado até 18/08, abrir a tela em 20/08 deixava o dia 19 de
     * fora e mostrava R$ 4.766,00; pedido a partir de 19/08, o mesmo caixa no
     * mesmo dia mostrava R$ 3.562,00. Um dos dois estava errado, e nada na
     * tela dizia qual — o número mudava conforme a data inicial escolhida.
     *
     * Então a gaveta é somada da sua janela: do dia seguinte ao fechamento até
     * o fim do recorte, incluindo os dias que ficaram de fora do filtro. O
     * recorte continua mandando no resto da tela — é dele que saem as
     * entradas, as saídas e a fila de conferir.
     *
     * Por dia inteiro, e não pelo instante guardado: fechamento assinado antes
     * de 02eaaea tem `ate` à meia-noite do último dia, e partir do instante
     * seguinte recontaria aquele dia todo.
     */
    const gavetaDesde = anterior
      ? dataDoDia(diaSeguinte(diaISO(anterior.ate)), 'inicial')
      : null;

    /*
     * As duas janelas saem de uma leitura só.
     *
     * Os dias que faltam são sempre mais velhos que o recorte, e a leitura do
     * IXC caminha do mais novo para o mais velho até passar do começo do
     * período. Pedir os dois intervalos em separado faria a segunda ida
     * percorrer de novo tudo o que a primeira já tinha percorrido — nesta
     * página, que já caiu uma vez com 502, isso se paga caro.
     */
    const { lancamentos: todos } = await this.caixa.listarLancamentos(
      caixaId,
      gavetaDesde && gavetaDesde < inicio ? gavetaDesde : inicio,
      fim,
      cfg,
    );
    /** O recorte pedido: é ele que a tela lista e confere. */
    const lancamentos = todos.filter((l) => l.data >= inicio);
    /** A janela da gaveta: o que ela viu desde o fechamento. */
    const daGaveta = gavetaDesde
      ? todos.filter((l) => l.data >= gavetaDesde)
      : [];

    const conferencias = await this.prisma.conferenciaCaixa.findMany({
      where: {
        caixaId,
        idLancamentoIxc: { in: lancamentos.map((l) => l.id) },
      },
      // Quantas fotos, e não as fotos: são centenas de KB cada, e uma semana de
      // caixa viraria megabytes de resposta para desenhar uma tabela.
      include: { _count: { select: { fotos: true } } },
    });
    const porId = new Map(conferencias.map((c) => [c.idLancamentoIxc, c]));

    const comConferencia: LancamentoConferido[] = lancamentos.map((l) => {
      const c = porId.get(l.id);
      return {
        ...l,
        conferido: c?.conferido ?? false,
        conferidoEm: c?.conferidoEm ?? null,
        // A foto não vai na listagem: a tela só precisa saber quantas existem.
        // Quem quer ver pede as daquele lançamento.
        qtdNotas: c?._count.fotos ?? 0,
        observacao: c?.observacao ?? null,
      };
    });

    // O que está na rua não é do período: é o que está aberto agora. Dinheiro
    // entregue mês passado e ainda não devolvido pesa no fechamento de hoje.
    const naRua = await this.prisma.dinheiroNaRua.findMany({
      where: { caixaId, baixadoEm: null },
      orderBy: { entregueEm: 'asc' },
      include: {
        movimentos: {
          orderBy: { data: 'asc' },
          include: { _count: { select: { fotos: true } } },
        },
      },
    });

    const fechamentos = await this.prisma.fechamentoCaixa.findMany({
      where: { caixaId, ate: { gte: inicio }, de: { lte: fim } },
      orderBy: { de: 'desc' },
    });

    /*
     * O que ficou para trás esperando conferência.
     *
     * A nota do acerto da rua chega quando chega: a pessoa levou dinheiro em
     * agosto, comprou em agosto e trouxe o papel em setembro. O acerto entra
     * pelo dia em que aconteceu — que é o certo, porque foi aí que a gaveta
     * mudou —, e a saída que ele cria no IXC nasce com aquela data. Só que a
     * tela olha o recorte de agora, e aquele dia já passou: a saída ia para a
     * fila de conferir e ninguém mais a via. Ficava pendente para sempre, num
     * lugar onde ninguém pensa em procurar.
     *
     * Então ela aparece aqui, seja qual for o recorte, até alguém conferi-la.
     * Sai do que esta casa guardou — o retrato que o acerto copiou —, e não de
     * uma varredura do IXC por datas antigas: é essa varredura que já derrubou
     * esta página, e ela não é necessária para responder "o que ficou".
     */
    const atrasados = await this.prisma.conferenciaCaixa.findMany({
      where: {
        caixaId,
        conferido: false,
        dataLancamento: { not: null, lt: inicio },
      },
      orderBy: { dataLancamento: 'asc' },
      take: 100,
      include: { _count: { select: { fotos: true } } },
    });

    /*
     * Até onde este caixa já está conferido, seja qual for o recorte na tela.
     *
     * Sem isto, "não achei o anterior" tem duas causas e uma frase só: o caixa
     * nunca foi fechado, ou o período pedido **começa dentro** de um que já foi
     * — 04/07 a 18/08 já assinado, e alguém pede de 01/08. A segunda é a comum
     * (o mês corrente é o recorte que a tela abre sozinha) e a mais cara: a
     * tela pedia o saldo inicial como se fosse o primeiro fechamento, e fechar
     * assim contaria de novo dezoito dias de saídas já conferidas.
     */
    const ultimo = await this.prisma.fechamentoCaixa.findFirst({
      where: { caixaId },
      orderBy: [{ ate: 'desc' }, { createdAt: 'desc' }],
      select: { ate: true },
    });
    const fechadoAte = ultimo ? diaISO(ultimo.ate) : null;

    /*
     * O dinheiro na rua mexe na gaveta sem passar pelo IXC.
     *
     * O que sai com alguém sai fisicamente e não vira saída lá; o troco volta
     * do mesmo jeito. Por isso os dois entram nesta conta, e cada um no período
     * em que aconteceu — a entrega pela data em que saiu, o troco pela data da
     * prestação. Sem isso o número na tela não seria o que a pessoa tem na mão.
     */
    const entregasDoPeriodo = await this.prisma.dinheiroNaRua.findMany({
      where: { caixaId, entregueEm: { gte: inicio, lte: fim } },
      select: { valor: true },
    });

    /*
     * Os acertos entram pelo dia em que aconteceram, e não pelo dia em que
     * foram digitados: quem leva dinheiro na segunda presta contas na sexta, e
     * a semana em que a gaveta mudou foi a da segunda.
     */
    const movimentosDoPeriodo = await this.prisma.movimentoDaRua.findMany({
      where: {
        entrega: { caixaId },
        OR: [
          { data: { gte: inicio, lte: fim } },
          { gastoPagoEm: { gte: inicio, lte: fim } },
        ],
      },
    });

    const somaDosMovimentos = (
      tipo: TipoMovimentoDaRua,
      quando: (m: (typeof movimentosDoPeriodo)[number]) => Date | null,
    ) =>
      arredondar(
        movimentosDoPeriodo
          .filter((m) => {
            if (m.tipo !== tipo) return false;
            const d = quando(m);
            return !!d && d >= inicio && d <= fim;
          })
          .reduce((s, m) => s + Number(m.valor), 0),
      );

    // O reforço sai da gaveta pelo mesmo motivo que a entrega: é dinheiro indo
    // para a mão de alguém sem passar pelo IXC.
    const entregueNoPeriodo = arredondar(
      entregasDoPeriodo.reduce((s, d) => s + Number(d.valor), 0) +
        somaDosMovimentos('REFORCO', (m) => m.data),
    );
    const trocoNoPeriodo = somaDosMovimentos('TROCO', (m) => m.data);

    /*
     * O gasto que a prestação lançou como conta a pagar volta para a conta.
     *
     * Não porque o dinheiro voltou — ele foi gasto —, mas porque ele já saiu
     * uma vez aqui, na entrega, e a conta a pagar baixada no caixa o faz sair
     * de novo pelas saídas do IXC. Descontar os dois tiraria da gaveta o dobro
     * do que a pessoa levou.
     *
     * A data que manda é a da baixa no IXC, e não a da prestação: é ela que
     * decide em que período a saída aparece lá, e quem presta contas costuma
     * fazê-lo dias depois de o dinheiro ter saído.
     */
    const gastoLancadoNoPeriodo = somaDosMovimentos(
      'NOTA',
      (m) => m.gastoPagoEm,
    );

    /*
     * O mesmo, na janela da gaveta.
     *
     * Sem dias fora do recorte as duas janelas são a mesma, e não custa
     * consulta nenhuma: é a conta que a tela já fez. Havendo, pergunta-se pelo
     * intervalo inteiro de uma vez — são duas leituras no banco daqui, baratas
     * ao lado da ida ao IXC.
     */
    const ruaDaGaveta =
      gavetaDesde && gavetaDesde < inicio
        ? await this.ruaNoIntervalo(caixaId, gavetaDesde, fim)
        : -entregueNoPeriodo + trocoNoPeriodo + gastoLancadoNoPeriodo;

    /*
     * O recibo assinado do diarista vale como nota do pagamento dele.
     *
     * A diária paga em mãos vira conta a pagar baixada no caixa, e a saída
     * chega aqui pedindo foto — só que a nota daquele pagamento já existe neste
     * sistema: é o recibo que a pessoa assinou com o dedo na tela. Sem esta
     * ligação, quem fecha o caixa imprimia o recibo, fotografava o papel e
     * anexava a foto do papel que o próprio sistema tinha gerado.
     *
     * Roda na leitura, e não no momento da assinatura, porque as duas coisas
     * não têm ordem garantida: assina-se antes ou depois de a baixa chegar ao
     * IXC. Aqui os dois lados já existem, e o que não casar hoje casa amanhã.
     */
    await this.ligarRecibosAssinados(caixaId, inicio, fim, comConferencia);

    const soma = (t: 'ENTRADA' | 'SAIDA') =>
      arredondar(
        comConferencia
          .filter((l) => l.tipo === t)
          .reduce((s, l) => s + l.valor, 0),
      );

    /** A mesma soma, na janela da gaveta — que pode ser maior que o recorte. */
    const somaDaGaveta = (t: 'ENTRADA' | 'SAIDA') =>
      arredondar(
        daGaveta.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0),
      );

    return {
      caixa: { id: caixaId, nome: oCaixa?.nome ?? `Caixa ${caixaId}` },
      de,
      ate,
      lancamentos: comConferencia,
      /** Saídas por conferir de dias anteriores ao recorte. Ver `atrasados`. */
      atrasados: atrasados.map((c) => ({
        id: c.id,
        idLancamentoIxc: c.idLancamentoIxc,
        dataLancamento: c.dataLancamento,
        valor: c.valor,
        historico: c.historico,
        observacao: c.observacao,
        qtdNotas: c._count.fotos,
      })),
      naRua: naRua.map(comSaldo),
      resumo: {
        entradas: soma('ENTRADA'),
        saidas: soma('SAIDA'),
        lancamentos: comConferencia.length,
        conferidos: comConferencia.filter((l) => l.conferido).length,
        /*
         * A conferência é das saídas.
         *
         * Um caixa de provedor recebe muito mais do que paga — neste, 109
         * recebimentos de cliente para 52 saídas no mesmo mês. Os recebimentos
         * contam no saldo e por isso continuam na lista, mas não é deles que
         * se pede nota nem se confere um a um: o que sai é que precisa de
         * papel. Exigir os 161 para fechar transformaria a conferência em
         * marcação cega, que é o contrário do que ela serve.
         */
        qtdSaidas: comConferencia.filter((l) => l.tipo === 'SAIDA').length,
        saidasConferidas: comConferencia.filter(
          (l) => l.tipo === 'SAIDA' && l.conferido,
        ).length,
        // O que ainda está com as pessoas — não o que um dia saiu com elas.
        naRua: arredondar(naRua.reduce((s, d) => s + saldoDaConta(d), 0)),
        pessoasNaRua: new Set(naRua.map((d) => d.pessoa.toLowerCase())).size,
        /** Null = não há de onde partir; `fechadoAte` diz por qual dos dois motivos. */
        saldoInicial,
        /**
         * Até que dia este caixa já está conferido (AAAA-MM-DD), ou null se
         * nunca foi fechado. Com `saldoInicial` nulo e este preenchido, o
         * período pedido invade um fechamento que já existe.
         */
        fechadoAte,
        entregueNoPeriodo,
        trocoNoPeriodo,
        /** O que as saídas do IXC já descontam por conta da prestação. */
        gastoLancadoNoPeriodo,
        /**
         * De que dia a gaveta está sendo somada (AAAA-MM-DD) — o dia seguinte
         * ao último fechamento, seja qual for o `de` pedido. Null quando não
         * há de onde partir.
         */
        gavetaDesde: gavetaDesde ? diaISO(gavetaDesde) : null,
        /**
         * O que deve estar na gaveta agora. Null enquanto falta o inicial.
         *
         * Não depende do recorte: conta desde o último fechamento, mesmo que a
         * tela esteja mostrando só os últimos dias.
         */
        saldoEsperado:
          saldoInicial === null
            ? null
            : arredondar(
                saldoInicial +
                  somaDaGaveta('ENTRADA') -
                  somaDaGaveta('SAIDA') +
                  ruaDaGaveta,
              ),
      },
      fechamentos,
    };
  }

  /**
   * O que o dinheiro na rua fez com a gaveta num intervalo, num número só.
   *
   * O que saiu com alguém sai fisicamente sem virar saída no IXC; o troco
   * volta do mesmo jeito; e o gasto que a prestação lançou como conta a pagar
   * volta para a conta, porque a baixa dele no caixa o faz sair uma segunda
   * vez pelas saídas de lá. Devolve o efeito líquido dos três.
   *
   * Só é chamado quando o recorte da tela deixa dias de fora da janela da
   * gaveta. No encaixe normal a conta já está feita, e este método não roda.
   */
  private async ruaNoIntervalo(
    caixaId: number,
    de: Date,
    ate: Date,
  ): Promise<number> {
    const entregas = await this.prisma.dinheiroNaRua.findMany({
      where: { caixaId, entregueEm: { gte: de, lte: ate } },
      select: { valor: true },
    });
    const movimentos = await this.prisma.movimentoDaRua.findMany({
      where: {
        entrega: { caixaId },
        OR: [
          { data: { gte: de, lte: ate } },
          { gastoPagoEm: { gte: de, lte: ate } },
        ],
      },
    });
    const somaDosMovimentos = (
      tipo: TipoMovimentoDaRua,
      quando: (m: (typeof movimentos)[number]) => Date | null,
    ) =>
      movimentos
        .filter((m) => {
          if (m.tipo !== tipo) return false;
          const d = quando(m);
          return !!d && d >= de && d <= ate;
        })
        .reduce((s, m) => s + Number(m.valor), 0);

    const entregue =
      entregas.reduce((s, d) => s + Number(d.valor), 0) +
      somaDosMovimentos('REFORCO', (m) => m.data);

    return arredondar(
      -entregue +
        somaDosMovimentos('TROCO', (m) => m.data) +
        somaDosMovimentos('NOTA', (m) => m.gastoPagoEm),
    );
  }

  /**
   * Liga o recibo assinado de cada diária à saída dela no caixa.
   *
   * O que existe dos dois lados é o valor e o nome de quem recebeu: a
   * movimentação do IXC guarda o histórico da baixa ("Pag. Fulano - doc.: 9"),
   * e a diária guarda o diarista. Não há um número em comum — o que a baixa
   * devolve é o id do título, e a conferência é indexada pelo id do lançamento.
   * Então o casamento é por valor mais nome, dentro do período, e só sobre
   * saídas que ainda não têm nota nenhuma.
   *
   * Uma diária só é ligada uma vez: o índice único em `diaria_id` é o que
   * garante isso mesmo se duas leituras acontecerem juntas.
   *
   * Falha para dentro. Isto é conveniência — poupar a foto do papel que o
   * próprio sistema imprimiu —, e derrubar por causa dela a leitura do caixa
   * seria trocar um incômodo por uma tela que não abre.
   */
  private async ligarRecibosAssinados(
    caixaId: number,
    inicio: Date,
    fim: Date,
    lancamentos: LancamentoConferido[],
  ) {
    try {
      const semNota = lancamentos.filter(
        (l) => l.tipo === 'SAIDA' && l.qtdNotas === 0,
      );
      if (semNota.length === 0) return;

      /*
       * As diárias assinadas do período que ainda não viraram nota.
       *
       * Só as pagas em mãos: a diária paga pelo banco não passa por gaveta
       * nenhuma, e o recibo dela não tem lançamento de caixa a que se ligar.
       */
      const candidatas = await this.prisma.diaria.findMany({
        where: {
          forma: 'EM_MAOS',
          notaNoCaixa: null,
          assinatura: { assinadoEm: { not: null } },
          data: { gte: mesesAntes(inicio, 2), lte: fim },
        },
        select: {
          id: true,
          valor: true,
          diarista: { select: { nome: true, nomeFantasia: true } },
        },
      });
      if (candidatas.length === 0) return;

      const usados = new Set<number>();
      for (const d of candidatas) {
        const valor = Number(d.valor);
        const nomes = [d.diarista.nome, d.diarista.nomeFantasia]
          .filter((n): n is string => !!n)
          .map((n) => n.trim().split(/\s+/)[0].toLowerCase())
          .filter((n) => n.length >= 3);

        const achado = semNota.find(
          (l) =>
            !usados.has(l.id) &&
            Math.abs(l.valor - valor) < 0.005 &&
            nomes.some((n) => l.historico.toLowerCase().includes(n)),
        );
        if (!achado) continue;
        usados.add(achado.id);

        const conferencia = await this.prisma.conferenciaCaixa.upsert({
          where: {
            caixaId_idLancamentoIxc: { caixaId, idLancamentoIxc: achado.id },
          },
          create: {
            caixaId,
            idLancamentoIxc: achado.id,
            dataLancamento: achado.data,
            valor: new Prisma.Decimal(arredondar(achado.valor)),
            historico: achado.historico,
          },
          update: {},
        });

        await this.prisma.fotoDaNota.create({
          data: { conferenciaId: conferencia.id, diariaId: d.id },
        });
        // A tela recebe o número já certo, sem precisar de outra ida.
        achado.qtdNotas += 1;
        this.logger.log(
          `Recibo assinado da diária ${d.id} virou a nota da saída ` +
            `#${achado.id} do caixa #${caixaId}.`,
        );
      }
    } catch (err) {
      this.logger.warn(
        'Não deu para ligar os recibos assinados às saídas do caixa: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /**
   * Marca ou desmarca um lançamento como conferido.
   *
   * O retrato do lançamento (data, valor, histórico) vem junto e fica gravado:
   * é ele que faz existir um histórico pesquisável meses depois, sem ter de
   * varrer o IXC mês a mês para achar um pagamento — a leitura que já derrubou
   * esta página com 502.
   */
  async conferir(
    caixaId: number,
    idLancamentoIxc: number,
    dados: {
      conferido?: boolean;
      observacao?: string | null;
      dataLancamento?: string;
      valor?: number;
      historico?: string;
    },
    usuarioId?: string,
  ) {
    const conferido = dados.conferido ?? true;
    const base = {
      conferido,
      conferidoEm: conferido ? new Date() : null,
      conferidoPor: conferido ? (usuarioId ?? null) : null,
      ...(dados.observacao === undefined
        ? {}
        : { observacao: dados.observacao?.trim() || null }),
      ...retratoDoLancamento(dados),
    };

    const salvo = await this.prisma.conferenciaCaixa.upsert({
      where: { caixaId_idLancamentoIxc: { caixaId, idLancamentoIxc } },
      create: { caixaId, idLancamentoIxc, ...base },
      update: base,
    });
    return { ...salvo, qtdNotas: await this.contarNotas(salvo.id) };
  }

  /**
   * Anexa mais uma foto à nota de um lançamento.
   *
   * Mais uma, e não "a" foto: uma nota nem sempre cabe numa só — cupom
   * comprido, verso escrito, a foto tremida que pede a segunda tentativa. O
   * campo único apagava a anterior sem avisar.
   */
  async adicionarNota(
    caixaId: number,
    idLancamentoIxc: number,
    foto: string,
    retrato: { dataLancamento?: string; valor?: number; historico?: string },
    usuarioId?: string,
  ) {
    const conferencia = await this.prisma.conferenciaCaixa.upsert({
      where: { caixaId_idLancamentoIxc: { caixaId, idLancamentoIxc } },
      create: { caixaId, idLancamentoIxc, ...retratoDoLancamento(retrato) },
      update: retratoDoLancamento(retrato),
    });

    await this.prisma.fotoDaNota.create({
      data: {
        conferenciaId: conferencia.id,
        foto,
        criadoPor: usuarioId ?? null,
      },
    });
    return { qtdNotas: await this.contarNotas(conferencia.id) };
  }

  /** As notas de um lançamento — os números, não as imagens. */
  async notas(caixaId: number, idLancamentoIxc: number) {
    const c = await this.prisma.conferenciaCaixa.findUnique({
      where: { caixaId_idLancamentoIxc: { caixaId, idLancamentoIxc } },
      select: {
        fotos: {
          select: { id: true, createdAt: true, diariaId: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return (c?.fotos ?? []).map(comTipoDaNota);
  }

  /**
   * Uma nota, sob demanda. É aqui que a imagem trafega, e em lugar nenhum mais.
   *
   * O recibo não trafega nem aqui: ele é um documento que o sistema monta na
   * hora, e a tela vai buscá-lo na rota que já existe para imprimi-lo.
   */
  async foto(id: string) {
    const f = await this.prisma.fotoDaNota.findUnique({
      where: { id },
      select: { foto: true, diariaId: true },
    });
    if (!f) return { foto: null, diariaId: null };
    return { foto: f.foto, diariaId: f.diariaId };
  }

  async apagarFoto(id: string) {
    const f = await this.prisma.fotoDaNota.findUnique({ where: { id } });
    if (!f) throw new BadRequestException('Esta foto não existe mais.');
    await this.prisma.fotoDaNota.delete({ where: { id } });
  }

  private async contarNotas(conferenciaId: string) {
    return this.prisma.fotoDaNota.count({ where: { conferenciaId } });
  }

  /**
   * O histórico do que já foi conferido, com busca.
   *
   * Lê só o que esta casa guardou — o retrato que a conferência copiou —, e
   * nunca o IXC: achar um pagamento de três meses atrás varrendo lá seria mês a
   * mês de leitura, que é o que derruba esta página. O preço é que só aparece
   * aqui o que passou pela conferência, e é exatamente esse o histórico que se
   * quer.
   */
  async historicoConferido(
    caixaId: number,
    filtros: { busca?: string; de?: string; ate?: string; limite?: number },
  ) {
    const busca = filtros.busca?.trim();
    const conferencias = await this.prisma.conferenciaCaixa.findMany({
      where: {
        caixaId,
        conferido: true,
        ...(filtros.de || filtros.ate
          ? {
              dataLancamento: {
                ...(filtros.de ? { gte: dataDoDia(filtros.de, 'inicial') } : {}),
                ...(filtros.ate
                  ? { lte: fimDoDia(dataDoDia(filtros.ate, 'final')) }
                  : {}),
              },
            }
          : {}),
        ...(busca
          ? {
              OR: [
                { historico: { contains: busca, mode: 'insensitive' as const } },
                { observacao: { contains: busca, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ dataLancamento: 'desc' }, { conferidoEm: 'desc' }],
      take: filtros.limite ?? 200,
      include: { _count: { select: { fotos: true } } },
    });

    return conferencias.map((c) => ({
      id: c.id,
      idLancamentoIxc: c.idLancamentoIxc,
      dataLancamento: c.dataLancamento,
      valor: c.valor,
      historico: c.historico,
      observacao: c.observacao,
      conferidoEm: c.conferidoEm,
      qtdNotas: c._count.fotos,
    }));
  }

  // -------------------------------------------------------------------------
  // Dinheiro na rua
  // -------------------------------------------------------------------------

  async entregar(
    dados: {
      caixaId: number;
      pessoa: string;
      valor: number;
      entregueEm?: string;
      motivo?: string;
    },
    usuarioId?: string,
  ) {
    const criado = await this.prisma.dinheiroNaRua.create({
      data: {
        caixaId: dados.caixaId,
        pessoa: dados.pessoa.trim(),
        valor: new Prisma.Decimal(dados.valor),
        entregueEm: dados.entregueEm
          ? dataDoDia(dados.entregueEm, 'da entrega')
          : new Date(),
        motivo: dados.motivo?.trim() || null,
        criadoPor: usuarioId ?? null,
      },
    });
    this.logger.log(
      `Dinheiro na rua: ${dados.valor} com ${criado.pessoa} ` +
        `(caixa #${dados.caixaId})`,
    );
    return comSaldo({ ...criado, movimentos: [] });
  }

  /**
   * Um acerto da conta de quem está com dinheiro da empresa.
   *
   * A entrega raramente se resolve de uma vez. A pessoa leva R$ 100,00, traz
   * nota de R$ 50,00 e fica com os outros R$ 50,00 para a próxima compra; às
   * vezes a compra passa do que ela tem na mão e mais dinheiro sai da gaveta
   * para completar. Exigir que nota e troco fechassem a entrega inteira de uma
   * vez — que era a regra antiga — obrigava a mentir num dos dois campos para o
   * botão liberar.
   *
   * Então cada acerto é um lançamento, e o saldo da pessoa anda com eles:
   *
   *  - `NOTA` comprova um gasto e desce o saldo. É esta que vira conta a pagar
   *    no IXC, quando vem com a despesa junto;
   *  - `TROCO` devolve dinheiro para a gaveta e desce o saldo;
   *  - `REFORCO` tira mais dinheiro da gaveta e sobe o saldo.
   *
   * Zerado o saldo, a conta se fecha sozinha.
   */
  async lancarMovimento(
    entregaId: string,
    dados: {
      tipo: TipoMovimentoDaRua;
      valor: number;
      /** Dia em que aconteceu (AAAA-MM-DD). Vazio = hoje. */
      data?: string;
      /** As fotos da nota que a pessoa trouxe. */
      notasFoto?: string[];
      observacao?: string;
      /** Só para NOTA: a conta a pagar a lançar pelo que foi gasto. */
      despesa?: DespesaDaPrestacao;
    },
    usuarioId?: string,
    usuarioNome?: string,
  ) {
    const conta = await this.prisma.dinheiroNaRua.findUnique({
      where: { id: entregaId },
      include: { movimentos: true },
    });
    if (!conta) throw new BadRequestException('Esta entrega não existe.');
    if (conta.baixadoEm) {
      throw new BadRequestException(
        'Esta conta já foi acertada — o saldo dela zerou.',
      );
    }

    if (!(dados.valor > 0)) {
      throw new BadRequestException('O valor precisa ser maior que zero.');
    }

    const saldo = saldoDaConta(conta);
    /*
     * Nota ou troco maior que o saldo é sempre engano de digitação, e um caro:
     * ele deixaria a pessoa devendo negativo, e o negativo entraria no total da
     * rua abatendo o saldo de quem realmente está com dinheiro. O reforço é o
     * único que pode passar — ele é dinheiro saindo, não acerto.
     */
    if (dados.tipo !== 'REFORCO' && dados.valor - saldo > 0.005) {
      throw new BadRequestException(
        `${conta.pessoa} está com ${formatar(saldo)}, e este lançamento é de ` +
          `${formatar(dados.valor)}. Se saiu mais dinheiro, registre o reforço ` +
          'antes.',
      );
    }

    if (dados.despesa && dados.tipo !== 'NOTA') {
      throw new BadRequestException(
        'Só a nota vira conta a pagar: troco e reforço não são despesa.',
      );
    }

    const dia = dados.data ? dataDoDia(dados.data, 'do lançamento') : new Date();

    /*
     * A despesa vai antes de gravar o movimento, de propósito.
     *
     * Não dando para lançá-la, nada é gravado e quem está prestando contas
     * tenta de novo com tudo ainda na tela. Na ordem inversa, uma falha do IXC
     * deixaria o saldo abatido aqui e a despesa em lugar nenhum.
     */
    const lancada = dados.despesa
      ? await this.lancarADespesa(conta, dados.valor, dados.despesa, dia, {
          usuarioId,
          usuarioNome,
        })
      : null;

    const movimento = await this.prisma.movimentoDaRua.create({
      include: { _count: { select: { fotos: true } } },
      data: {
        entregaId,
        tipo: dados.tipo,
        valor: new Prisma.Decimal(arredondar(dados.valor)),
        data: dia,
        observacao: dados.observacao?.trim() || null,
        criadoPor: usuarioId ?? null,
        ...(dados.notasFoto?.length
          ? {
              fotos: {
                create: dados.notasFoto.map((foto) => ({
                  foto,
                  criadoPor: usuarioId ?? null,
                })),
              },
            }
          : {}),
        ...(lancada
          ? {
              idFnApagarIxc: lancada.idFnApagarIxc,
              contaPagarId: lancada.contaPagarId,
              fornecedorNome: lancada.fornecedorNome,
              gastoPagoEm: lancada.pagoEm,
            }
          : {}),
      },
    });

    /*
     * A saída que a despesa criou no IXC recebe as fotos do acerto — e só isso.
     *
     * A foto vai porque fotografar de novo a mesma nota é trabalho repetido por
     * um detalhe de arquitetura: a do acerto mora no lançamento da rua, a da
     * conferência mora na conferência. O "OK" **não** vai: a saída tem de
     * passar pela fila de conferência como qualquer outra. Quem presta contas e
     * quem confere o caixa não são o mesmo gesto, e dar por conferido o que a
     * própria pessoa acabou de lançar tira da conferência o sentido que ela
     * tem.
     */
    if (lancada?.pagoEm && dados.notasFoto?.length) {
      await this.levarAsFotosParaAConferencia({
        caixaId: conta.caixaId,
        valor: dados.valor,
        dia: lancada.pagoEm,
        fornecedor: lancada.fornecedorNome,
        notasFoto: dados.notasFoto,
        usuarioId,
      });
    }

    /*
     * Zerou, fecha. O acerto não é um botão à parte: quem acabou de devolver o
     * último real já disse tudo o que havia para dizer, e pedir uma confirmação
     * depois disso só deixaria contas zeradas abertas na tela por esquecimento.
     */
    const novoSaldo = arredondar(
      saldo + (dados.tipo === 'REFORCO' ? dados.valor : -dados.valor),
    );
    const fechou = Math.abs(novoSaldo) < 0.005;
    if (fechou) {
      await this.prisma.dinheiroNaRua.update({
        where: { id: entregaId },
        data: { baixadoEm: new Date(), baixadoPor: usuarioId ?? null },
      });
    }

    this.logger.log(
      `${dados.tipo} de ${dados.valor} na conta de ${conta.pessoa}: ` +
        `saldo ${saldo} -> ${novoSaldo}` +
        (lancada ? `, título #${lancada.idFnApagarIxc ?? '?'} no IXC` : '') +
        (fechou ? ' (conta acertada)' : ''),
    );

    return {
      movimento: comQtdNotas(movimento),
      saldo: novoSaldo,
      acertada: fechou,
      despesa: lancada,
    };
  }

  /**
   * Leva as fotos do acerto para a saída que a despesa criou no IXC.
   *
   * O que se conhece depois da baixa é o número do **título** (`fn_apagar`), e
   * o que a conferência indexa é o número do **lançamento** da movimentação —
   * dois números diferentes, e o segundo o IXC não devolve. Então ele é
   * procurado: entre as saídas daquele caixa naquele dia, a do mesmo valor que
   * ainda não tem foto nenhuma. Havendo mais de uma candidata, o nome do
   * fornecedor no histórico desempata.
   *
   * A saída continua **por conferir**: o que viaja é a foto, não o "olhei".
   *
   * Falha para dentro, sempre. Isto é conveniência — poupar a segunda foto da
   * mesma nota —, e derrubar por causa dela um acerto que já escreveu no IXC
   * seria trocar um incômodo por um estrago.
   */
  private async levarAsFotosParaAConferencia(dados: {
    caixaId: number;
    valor: number;
    dia: Date;
    fornecedor: string;
    notasFoto: string[];
    usuarioId?: string;
  }) {
    try {
      const cfg = await this.config.obter();
      const { lancamentos } = await this.caixa.listarLancamentos(
        dados.caixaId,
        dados.dia,
        dados.dia,
        cfg,
      );

      const doValor = lancamentos.filter(
        (l) => l.tipo === 'SAIDA' && Math.abs(l.valor - dados.valor) < 0.005,
      );
      if (doValor.length === 0) {
        this.logger.warn(
          `Não achei no IXC a saída de ${dados.valor} do caixa #${dados.caixaId} ` +
            `em ${diaISO(dados.dia)} para anexar a foto. Ela vai aparecer na ` +
            'lista para receber a foto à mão.',
        );
        return;
      }

      // O que já tem foto não se toma de novo: numa fatura de dois pagamentos
      // iguais no mesmo dia, o segundo tem de achar o segundo.
      const jaComFoto = await this.prisma.conferenciaCaixa.findMany({
        where: {
          caixaId: dados.caixaId,
          idLancamentoIxc: { in: doValor.map((l) => l.id) },
          fotos: { some: {} },
        },
        select: { idLancamentoIxc: true },
      });
      const tomados = new Set(jaComFoto.map((c) => c.idLancamentoIxc));
      const livres = doValor.filter((l) => !tomados.has(l.id));
      if (livres.length === 0) return;

      const primeiroNome = dados.fornecedor.trim().split(/\s+/)[0]?.toLowerCase();
      const escolhido =
        (primeiroNome &&
          livres.find((l) => l.historico.toLowerCase().includes(primeiroNome))) ||
        livres[0];

      // O retrato vem do próprio lançamento achado: é ele que o histórico
      // vai pesquisar depois.
      const retrato = {
        dataLancamento: escolhido.data,
        valor: new Prisma.Decimal(arredondar(escolhido.valor)),
        historico: escolhido.historico,
      };
      const conferencia = await this.prisma.conferenciaCaixa.upsert({
        where: {
          caixaId_idLancamentoIxc: {
            caixaId: dados.caixaId,
            idLancamentoIxc: escolhido.id,
          },
        },
        create: {
          caixaId: dados.caixaId,
          idLancamentoIxc: escolhido.id,
          ...retrato,
        },
        update: retrato,
      });

      await this.prisma.fotoDaNota.createMany({
        data: dados.notasFoto.map((foto) => ({
          conferenciaId: conferencia.id,
          foto,
          criadoPor: dados.usuarioId ?? null,
        })),
      });
      this.logger.log(
        `Saída #${escolhido.id} do caixa #${dados.caixaId} recebeu ` +
          `${dados.notasFoto.length} foto(s) do acerto da rua. Ela continua ` +
          'por conferir.',
      );
    } catch (err) {
      this.logger.warn(
        'Não deu para dar por conferida a saída criada no IXC: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /**
   * Lança o gasto como conta a pagar, quitada no caixa de onde o dinheiro saiu.
   *
   * O caixa é o da entrega, e não o padrão da configuração: o dinheiro saiu
   * daquela gaveta, e é dela que a saída tem de sair no IXC.
   *
   * `pagoEm` só volta preenchido quando o IXC deu a conta por paga. É esta data
   * que faz o saldo somar o gasto de volta, para o mesmo dinheiro não ser
   * descontado duas vezes — uma pela entrega, outra pela saída lá. Título
   * criado que não chegou a ser baixado não gera saída nenhuma, e portanto não
   * pode gerar compensação: o aviso volta para a tela e a conta se paga pela
   * lista de contas em aberto.
   */
  private async lancarADespesa(
    entrega: { caixaId: number; pessoa: string },
    valorGasto: number,
    despesa: DespesaDaPrestacao,
    quando: Date,
    quem: { usuarioId?: string; usuarioNome?: string },
  ) {
    const dia = despesa.pagoEm?.trim() || diaISO(quando);
    const fornecedorNome = despesa.fornecedorNome.trim();

    const lancamento = await this.despesas.lancar(
      {
        idFornecedorIxc: despesa.idFornecedorIxc,
        fornecedorNome,
        valor: valorGasto,
        // As três datas são o mesmo dia: a conta não tem vencimento futuro a
        // esperar, ela nasce quitada com a data em que o dinheiro saiu.
        dataEmissao: dia,
        dataVencimento: dia,
        dataPagamento: dia,
        observacao: despesa.descricao.trim(),
        categoriaId: despesa.categoriaId ?? null,
        tipoPagamento: despesa.tipoPagamento,
        contaContabil: despesa.contaContabil,
        contaPagamento: entrega.caixaId,
        jaPaga: true,
      },
      quem.usuarioId,
      quem.usuarioNome,
    );

    const paga = (lancamento.baixa?.pagas ?? 0) > 0;
    const avisos = [
      ...(lancamento.baixa?.avisos ?? []),
      ...(lancamento.avisoCategoria ? [lancamento.avisoCategoria] : []),
    ];
    if (!paga) {
      this.logger.warn(
        `Despesa de ${entrega.pessoa} lançada, mas não ficou paga no IXC: ` +
          (avisos.join(' ') || 'sem detalhe'),
      );
    }

    return {
      contaPagarId: lancamento.conta.id,
      idFnApagarIxc: lancamento.conta.idFnApagarIxc,
      fornecedorNome,
      /** Null quando a baixa não saiu — sem saída no IXC, sem compensação. */
      pagoEm: paga ? dataDoDia(dia, 'do pagamento') : null,
      paga,
      valor: valorGasto,
      avisos,
    };
  }

  /** As notas de um acerto da rua — os números, não as imagens. */
  async notasDoMovimento(id: string) {
    const m = await this.prisma.movimentoDaRua.findUnique({
      where: { id },
      select: {
        fotos: {
          select: { id: true, createdAt: true, diariaId: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return (m?.fotos ?? []).map(comTipoDaNota);
  }

  /** Anexa mais uma foto a um acerto já lançado. */
  async adicionarNotaAoMovimento(id: string, foto: string, usuarioId?: string) {
    const m = await this.prisma.movimentoDaRua.findUnique({ where: { id } });
    if (!m) throw new BadRequestException('Este lançamento não existe.');
    await this.prisma.fotoDaNota.create({
      data: { movimentoId: id, foto, criadoPor: usuarioId ?? null },
    });
    return { qtdNotas: await this.prisma.fotoDaNota.count({ where: { movimentoId: id } }) };
  }

  /**
   * Desfaz um lançamento — qualquer um da conta, e não só o último.
   *
   * Quem digita 100 no lugar de 10 percebe depois de já ter lançado o troco, e
   * obrigar a desfazer de trás para frente era só burocracia: o saldo é uma
   * soma, e some qualquer parcela que se tire.
   *
   * O que não dá para desfazer sozinho é o que virou título no IXC. Apagar só
   * deste lado deixaria a saída viva lá — o caixa passaria a descontar um
   * dinheiro que ninguém compensa, e a gaveta apareceria menor do que é. Então
   * o app tenta apagar o título junto; não conseguindo, recusa e diz o número,
   * para o acerto se resolver onde ele existe.
   */
  async desfazerMovimento(id: string) {
    const m = await this.prisma.movimentoDaRua.findUnique({ where: { id } });
    if (!m) throw new BadRequestException('Este lançamento não existe.');

    if (m.idFnApagarIxc) {
      try {
        await this.pagamentos.excluir(m.idFnApagarIxc);
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        throw new BadRequestException(
          `Este lançamento virou a conta a pagar #${m.idFnApagarIxc} no IXC, e ` +
            `ela não pôde ser apagada de lá: ${motivo} Estorne o pagamento ` +
            'dela no IXC (Pagar > Estornar pagamento recebido) e desfaça aqui ' +
            'de novo — senão a saída continua contando lá e a gaveta aparece ' +
            'menor do que está.',
        );
      }
      this.logger.log(
        `Título #${m.idFnApagarIxc} apagado no IXC ao desfazer o lançamento ${id}`,
      );
    }

    await this.prisma.movimentoDaRua.delete({ where: { id } });
    // A conta reabre: ela só estava fechada porque o saldo tinha zerado.
    await this.prisma.dinheiroNaRua.update({
      where: { id: m.entregaId },
      data: { baixadoEm: null, baixadoPor: null },
    });
  }

  /**
   * Desfaz o acerto inteiro: a conta volta a ser só a entrega.
   *
   * É o botão de quem se perdeu no meio e prefere recomeçar a caçar qual das
   * três linhas está errada. Os que não puderem ser desfeitos — os que viraram
   * título pago no IXC — ficam, e voltam nomeados: desfazer pela metade em
   * silêncio seria pior que não desfazer.
   */
  async desfazerAcertos(entregaId: string) {
    const conta = await this.prisma.dinheiroNaRua.findUnique({
      where: { id: entregaId },
      include: {
        movimentos: {
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { fotos: true } } },
        },
      },
    });
    if (!conta) throw new BadRequestException('Esta entrega não existe.');

    const mantidos: string[] = [];
    let desfeitos = 0;
    for (const m of conta.movimentos) {
      try {
        await this.desfazerMovimento(m.id);
        desfeitos += 1;
      } catch (err) {
        mantidos.push(err instanceof Error ? err.message : String(err));
      }
    }

    const atual = await this.prisma.dinheiroNaRua.findUnique({
      where: { id: entregaId },
      include: {
        movimentos: {
          orderBy: { data: 'asc' },
          include: { _count: { select: { fotos: true } } },
        },
      },
    });
    return { desfeitos, mantidos, conta: atual ? comSaldo(atual) : null };
  }

  async apagarEntrega(id: string) {
    const atual = await this.prisma.dinheiroNaRua.findUnique({
      where: { id },
      include: { movimentos: { select: { id: true } } },
    });
    if (!atual) throw new BadRequestException('Esta entrega não existe.');
    if (atual.movimentos.length > 0) {
      throw new BadRequestException(
        'Esta conta já tem acerto lançado — apagá-la reescreveria um caixa ' +
          'que já foi conferido. Desfaça os lançamentos primeiro.',
      );
    }
    await this.prisma.dinheiroNaRua.delete({ where: { id } });
  }

  /** O histórico de contas de um caixa, as já acertadas inclusive. */
  async historicoDaRua(caixaId: number) {
    const itens = await this.prisma.dinheiroNaRua.findMany({
      where: { caixaId },
      orderBy: [{ entregueEm: 'desc' }],
      take: 200,
      include: {
        movimentos: {
          orderBy: { data: 'asc' },
          include: { _count: { select: { fotos: true } } },
        },
      },
    });
    return itens.map(comSaldo);
  }

  // -------------------------------------------------------------------------
  // Fechar
  // -------------------------------------------------------------------------

  /**
   * Dá o período por conferido, guardando os números do momento.
   *
   * Fechar com lançamento por conferir é recusado: o fechamento diz "olhei
   * tudo", e assiná-lo pela metade tira dele o único sentido que tem. Dinheiro
   * na rua, ao contrário, não impede — ele é parte da explicação de por que a
   * gaveta tem menos do que a soma diz, e vai registrado no fechamento.
   */
  async fechar(
    dados: {
      caixaId: number;
      de: string;
      ate: string;
      observacao?: string;
      /** Só no primeiro fechamento do caixa: de onde a contagem começa. */
      saldoInicial?: number;
      /** Quanto se contou na gaveta ao fechar, quando se contou. */
      saldoContado?: number;
    },
    usuarioId?: string,
  ) {
    const extrato = await this.extrato(dados.caixaId, dados.de, dados.ate);

    /*
     * Período que começa dentro de outro já fechado é recusado.
     *
     * As saídas daqueles dias já foram conferidas e já entraram num saldo
     * assinado; contá-las de novo somaria as mesmas duas vezes, e o segundo
     * fechamento passaria a disputar com o primeiro o posto de "anterior" do
     * seguinte. Barrar aqui, e não só avisar na tela, porque o estrago é
     * silencioso: os números saem plausíveis e errados.
     */
    if (extrato.resumo.fechadoAte && dados.de <= extrato.resumo.fechadoAte) {
      throw new BadRequestException(
        `Este caixa já está fechado até ${formatarDia(extrato.resumo.fechadoAte)}. ` +
          `Comece o período em ${formatarDia(diaSeguinte(extrato.resumo.fechadoAte))} — ` +
          'recontar dias já conferidos somaria as mesmas saídas duas vezes.',
      );
    }

    /*
     * Período que pula dias desde o último fechamento também é recusado.
     *
     * O outro lado do mesmo erro: o saldo inicial vem do fechamento anterior,
     * e ele não sabe o que aconteceu nos dias saltados. Fechar assim assinaria
     * um saldo final que já nasce sem o movimento daqueles dias — e o próximo
     * período partiria dele. A tela avisa antes; aqui se barra, porque o
     * estrago fica guardado.
     */
    if (
      extrato.resumo.fechadoAte &&
      dados.de > diaSeguinte(extrato.resumo.fechadoAte)
    ) {
      const primeiro = diaSeguinte(extrato.resumo.fechadoAte);
      throw new BadRequestException(
        `Este caixa está conferido até ${formatarDia(extrato.resumo.fechadoAte)}, ` +
          `e os dias a partir de ${formatarDia(primeiro)} ficariam de fora da ` +
          `contagem. Comece o período em ${formatarDia(primeiro)}.`,
      );
    }

    const faltam = extrato.resumo.qtdSaidas - extrato.resumo.saidasConferidas;
    if (faltam > 0) {
      throw new BadRequestException(
        `Ainda ${
          faltam === 1 ? 'falta 1 saída' : `faltam ${faltam} saídas`
        } por conferir neste período.`,
      );
    }

    /*
     * O primeiro fechamento de um caixa precisa saber de onde a gaveta parte;
     * do segundo em diante, o anterior responde. Recusar aqui, e não assumir
     * zero, porque zero silencioso vira um saldo errado que se propaga por
     * todos os fechamentos seguintes — cada um herdando o erro do anterior.
     */
    const saldoInicial = extrato.resumo.saldoInicial ?? dados.saldoInicial;
    if (saldoInicial === undefined || saldoInicial === null) {
      throw new BadRequestException(
        'Este caixa nunca foi fechado por aqui: informe quanto havia na gaveta ' +
          'no início do período para a contagem ter de onde partir.',
      );
    }

    const saldoFinal = arredondar(
      saldoInicial +
        Number(extrato.resumo.entradas) -
        Number(extrato.resumo.saidas) -
        extrato.resumo.entregueNoPeriodo +
        extrato.resumo.trocoNoPeriodo +
        extrato.resumo.gastoLancadoNoPeriodo,
    );

    if (dados.saldoContado !== undefined && dados.saldoContado < 0) {
      throw new BadRequestException('A gaveta não conta valor negativo.');
    }
    const saldoContado =
      dados.saldoContado === undefined
        ? null
        : arredondar(dados.saldoContado);

    const fechamento = await this.prisma.fechamentoCaixa.create({
      data: {
        caixaId: dados.caixaId,
        caixaNome: extrato.caixa.nome,
        de: dataDoDia(dados.de, 'inicial'),
        // Guardado como o fim do dia, pelo mesmo motivo: um fechamento "até
        // 18/08" termina quando o dia 18 acaba, não quando ele começa.
        ate: fimDoDia(dataDoDia(dados.ate, 'final')),
        totalEntradas: new Prisma.Decimal(extrato.resumo.entradas),
        totalSaidas: new Prisma.Decimal(extrato.resumo.saidas),
        lancamentos: extrato.resumo.qtdSaidas,
        conferidos: extrato.resumo.saidasConferidas,
        totalNaRua: new Prisma.Decimal(extrato.resumo.naRua),
        saldoInicial: new Prisma.Decimal(saldoInicial),
        saldoFinal: new Prisma.Decimal(saldoFinal),
        saldoContado:
          saldoContado === null ? null : new Prisma.Decimal(saldoContado),
        observacao: dados.observacao?.trim() || null,
        fechadoPor: usuarioId ?? null,
      },
    });
    this.logger.log(
      `Caixa "${extrato.caixa.nome}" fechado de ${dados.de} a ${dados.ate}: ` +
        `${extrato.resumo.saidasConferidas} saída(s) conferida(s), ` +
        `saldo de ${saldoFinal}` +
        (saldoContado === null ? '' : ` (contados ${saldoContado})`) +
        `, ${extrato.resumo.naRua} ainda na rua`,
    );
    return fechamento;
  }

  /**
   * Corrige o que se contou na gaveta num fechamento já assinado.
   *
   * Só o último de cada caixa aceita correção. Os totais de um fechamento são
   * uma cópia do que se viu no dia, de propósito — mexer num do meio deixaria
   * os seguintes apoiados num saldo que não existe mais, sem nada na tela
   * denunciando. O último não tem ninguém apoiado nele: é o próximo período,
   * que ainda não fechou, que vai ler este número.
   */
  async corrigirContagem(id: string, saldoContado: number, usuarioId?: string) {
    if (saldoContado < 0) {
      throw new BadRequestException('A gaveta não conta valor negativo.');
    }

    const fechamento = await this.prisma.fechamentoCaixa.findUnique({
      where: { id },
    });
    if (!fechamento) {
      throw new BadRequestException('Este fechamento não existe.');
    }

    const ultimo = await this.prisma.fechamentoCaixa.findFirst({
      where: { caixaId: fechamento.caixaId },
      orderBy: [{ ate: 'desc' }, { createdAt: 'desc' }],
    });
    if (ultimo && ultimo.id !== id) {
      throw new BadRequestException(
        'Este caixa já foi fechado de novo depois deste período. Corrigir a ' +
          'contagem aqui mudaria o ponto de partida de fechamentos que já ' +
          'foram assinados — a correção se faz no último.',
      );
    }

    const salvo = await this.prisma.fechamentoCaixa.update({
      where: { id },
      data: { saldoContado: new Prisma.Decimal(arredondar(saldoContado)) },
    });
    const diferenca = arredondar(
      Number(salvo.saldoContado) - Number(salvo.saldoFinal),
    );
    this.logger.log(
      `Contagem do fechamento ${id} corrigida para ${saldoContado} ` +
        `(calculado: ${Number(salvo.saldoFinal)}, diferença de ${diferenca})` +
        (usuarioId ? ` por ${usuarioId}` : ''),
    );
    return salvo;
  }

  async listarFechamentos(caixaId: number) {
    return this.prisma.fechamentoCaixa.findMany({
      where: { caixaId },
      orderBy: { de: 'desc' },
      take: 50,
    });
  }

  /**
   * O histórico de um período fechado, completo.
   *
   * O `historicoConferido` procura por data, e por isso não achava o que não
   * tem data: as conferências do primeiro caixa batido guardaram só o número do
   * lançamento no IXC — o retrato (data, valor, histórico) passou a ser copiado
   * depois delas. Eram 133 de 149 neste caixa, e o período abria dizendo "133
   * saídas conferidas" e listando seis.
   *
   * Então, antes de listar, este caminho completa o que falta lendo o IXC uma
   * vez na janela do próprio período. É a única leitura do IXC em todo o
   * histórico, e ela existe porque um retrato que falta não se inventa daqui —
   * e porque, uma vez copiado, ele fica: a segunda abertura do mesmo período já
   * não lê nada.
   */
  async historicoDoFechamento(fechamentoId: string) {
    const f = await this.prisma.fechamentoCaixa.findUnique({
      where: { id: fechamentoId },
    });
    if (!f) throw new BadRequestException('Este fechamento não existe mais.');

    const completados = await this.completarRetratos(f.caixaId, f.de, f.ate);
    const itens = await this.historicoConferido(f.caixaId, {
      de: diaISO(f.de),
      ate: diaISO(f.ate),
      limite: 1000,
    });
    return { itens, completados };
  }

  /**
   * Copia do IXC o retrato das conferências que não guardaram nenhum.
   *
   * Só as que ficaram sem data — as outras já respondem por si. A leitura é uma
   * só, da janela pedida, e o que casa por número de lançamento é preenchido; o
   * que não casa ficou fora da janela e espera a janela dele.
   *
   * Falhar aqui não pode derrubar a tela: sem o IXC o período abre como abria
   * antes, incompleto, que é melhor do que não abrir.
   */
  private async completarRetratos(
    caixaId: number,
    inicio: Date,
    fim: Date,
  ): Promise<number> {
    const semRetrato = await this.prisma.conferenciaCaixa.findMany({
      where: { caixaId, dataLancamento: null },
      select: { id: true, idLancamentoIxc: true },
    });
    if (semRetrato.length === 0) return 0;

    try {
      const cfg = await this.config.obter();
      const { lancamentos } = await this.caixa.listarLancamentos(
        caixaId,
        inicio,
        fim,
        cfg,
      );
      const porId = new Map(lancamentos.map((l) => [l.id, l]));

      let completados = 0;
      for (const c of semRetrato) {
        const l = porId.get(c.idLancamentoIxc);
        if (!l) continue;
        await this.prisma.conferenciaCaixa.update({
          where: { id: c.id },
          data: {
            dataLancamento: l.data,
            valor: new Prisma.Decimal(arredondar(l.valor)),
            historico: l.historico,
          },
        });
        completados += 1;
      }
      if (completados > 0) {
        this.logger.log(
          `Caixa #${caixaId}: ${completados} conferência(s) recuperaram do IXC ` +
            'a data, o valor e o histórico que não tinham guardado.',
        );
      }
      return completados;
    } catch (err) {
      this.logger.warn(
        `Caixa #${caixaId}: não deu para completar o retrato das conferências ` +
          `antigas (${err instanceof Error ? err.message : String(err)}).`,
      );
      return 0;
    }
  }
}

/**
 * De quanto o período seguinte parte: a contagem, quando houve, senão a conta.
 *
 * Contar a gaveta é o único jeito de a soma encontrar a realidade. Onde os dois
 * discordam, quem tem razão é o dinheiro que dá para pegar na mão.
 */
function saldoQueSegue(f: {
  saldoFinal: Prisma.Decimal;
  saldoContado: Prisma.Decimal | null;
}): Prisma.Decimal {
  return f.saldoContado ?? f.saldoFinal;
}

/** Uma conta da rua com o que se precisa saber dela: quanto ainda está fora. */
function comSaldo<
  T extends { movimentos: Array<{ _count?: { fotos: number } }> },
>(conta: T) {
  return {
    ...conta,
    saldo: saldoDaConta(conta as never),
    movimentos: conta.movimentos.map(comQtdNotas),
  };
}

/**
 * Quantas fotos há, e nenhuma delas.
 *
 * São centenas de KB cada: uma semana de caixa viraria megabytes de resposta
 * para desenhar uma tabela. Quem quer ver pede as daquele lançamento.
 */
function comQtdNotas<T extends { _count?: { fotos: number } }>(registro: T) {
  const { _count, ...resto } = registro;
  return { ...resto, qtdNotas: _count?.fotos ?? 0 };
}

/**
 * O que ainda está com a pessoa: a entrega, mais os reforços, menos o que ela
 * já acertou em nota e em troco.
 */
function saldoDaConta(conta: {
  valor: Prisma.Decimal;
  movimentos: Array<{ tipo: TipoMovimentoDaRua; valor: Prisma.Decimal }>;
}): number {
  return arredondar(
    conta.movimentos.reduce(
      (s, m) => s + (m.tipo === 'REFORCO' ? Number(m.valor) : -Number(m.valor)),
      Number(conta.valor),
    ),
  );
}

/**
 * O retrato do lançamento, para gravar junto da conferência.
 *
 * Só o que veio: um "conferir" que não mande o retrato não apaga o que já
 * estava gravado — a marca e a foto podem chegar em ordens diferentes.
 */
function retratoDoLancamento(d: {
  dataLancamento?: string;
  valor?: number;
  historico?: string;
}) {
  return {
    ...(d.dataLancamento
      ? { dataLancamento: dataDoDia(d.dataLancamento, 'do lançamento') }
      : {}),
    ...(d.valor === undefined
      ? {}
      : { valor: new Prisma.Decimal(arredondar(d.valor)) }),
    ...(d.historico ? { historico: d.historico } : {}),
  };
}

/** "AAAA-MM-DD" para Date, recusando o que não é data. */
function dataDoDia(valor: string, qual: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor).trim());
  if (!m) {
    throw new BadRequestException(
      `A data ${qual} precisa estar no formato AAAA-MM-DD.`,
    );
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`A data ${qual} não existe no calendário.`);
  }
  return d;
}

/**
 * Uma nota diz o que é: foto tirada, ou recibo assinado.
 *
 * A tela precisa saber antes de pedir o conteúdo — uma abre numa imagem, a
 * outra abre no PDF do recibo.
 */
function comTipoDaNota<T extends { diariaId: string | null }>(nota: T) {
  return { ...nota, tipo: nota.diariaId ? ('RECIBO' as const) : ('FOTO' as const) };
}

/** A mesma data, alguns meses antes. */
function mesesAntes(d: Date, meses: number): Date {
  const antes = new Date(d);
  antes.setMonth(antes.getMonth() - meses);
  return antes;
}

/** O último instante do dia de uma data. */
function fimDoDia(d: Date): Date {
  const f = new Date(d);
  f.setHours(23, 59, 59, 999);
  return f;
}

/** "AAAA-MM-DD" para o dia seguinte, também em "AAAA-MM-DD". */
function diaSeguinte(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  return diaISO(new Date(a, m - 1, d + 1));
}

/** "AAAA-MM-DD" para "DD/MM/AAAA", que é como a frase de erro o mostra. */
function formatarDia(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/** Date para "AAAA-MM-DD", no fuso de quem está batendo o caixa. */
function diaISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatar(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
