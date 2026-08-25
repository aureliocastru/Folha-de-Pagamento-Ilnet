import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TipoLancamento } from '@prisma/client';
import { IxcClient } from '../ixc/ixc.client';
import { lerSituacaoContaPagar } from '../ixc/ixc.financeiro';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriasService } from './categorias.service';
import {
  explicarFiltro,
  mapContaAberta,
  motivoDeNaoEstarAberto,
  STATUS_DE_PAGO,
  type AvaliacaoDoFiltro,
  ordenarPorUrgencia,
  resumirContasAbertas,
  type ContaAberta,
  type ResumoContasAbertas,
} from './contas-abertas.mapper';

/** O título do IXC por inteiro, com a leitura que o filtro daqui faz dele. */
export interface DetalheDoTitulo {
  campos: Record<string, unknown>;
  filtro: AvaliacaoDoFiltro;
}

/** O que a tela recebe de uma vez. */
export interface ContasAbertasResposta {
  contas: ContaAberta[];
  resumo: ResumoContasAbertas;
  /** Quando a lista foi lida do IXC — ela é de agora, não de um espelho */
  lidoEm: Date;
  /** O que não deu para completar, sem derrubar a lista */
  avisos: string[];
}

/** Uma conta de onde o dinheiro sai: banco ou caixa. */
export interface ContaDePagamento {
  /** `fn_apagar.id_contas` */
  id: number;
  nome: string;
  ativa: boolean;
  /** É uma das que costumam pagar os débitos — aparece no topo da lista. */
  usual: boolean;
}

/**
 * As contas por onde os débitos da empresa costumam sair, na ordem em que a
 * tela as oferece: Sicoob, Bradesco, ModoBank (o PIX) e o caixa do Werick, que
 * é o pagamento em mãos. As outras treze do cadastro do IXC continuam
 * escolhíveis, só não disputam espaço com estas.
 */
const CONTAS_QUE_COSTUMAM_PAGAR = [14, 15, 18, 23];

/** Quanto a empresa já pagou num mês, pelo contas a pagar do IXC. */
export interface PagamentosDoMes {
  /** "AAAA-MM" */
  mes: string;
  total: number;
  quantidade: number;
  lidoEm: Date;
  /** false = a leitura bateu no teto de páginas e o total pode faltar coisa. */
  completo: boolean;
}

/**
 * Quantos títulos a lista aceita puxar de uma vez. Um provedor com anos de
 * histórico tem muita conta; o teto existe para uma base grande não travar a
 * tela — e o aviso conta que houve corte, em vez de mostrar um total errado
 * como se fosse o total.
 */
const TETO_DE_TITULOS = 3000;

/**
 * Até onde a busca pelas contas pagas vai antes de desistir. Quinhentos
 * registros por página cobrem meses de pagamento numa empresa deste tamanho; o
 * teto existe para uma base com histórico grande não prender a tela.
 */
const TETO_DE_PAGINAS_PAGAS = 8;

/**
 * O nome de uma conta do plano, seja qual for a coluna que a base usa. No
 * `planejamento_analitico` a coluna tem o mesmo nome da tabela; nas outras
 * versões conhecidas é `descricao` ou `nome`.
 */
function nomeDaConta(raw: Record<string, unknown>, tabela: string): string {
  return String(
    raw[tabela] ?? raw.descricao ?? raw.nome ?? raw.conta ?? '',
  ).trim();
}

/** "AAAA-MM" do mês corrente. */
function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

/** "AAAA-MM" de uma data, lida em UTC como o resto das datas do IXC. */
function mesDaData(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** De quanto em quanto tempo vale reler os cadastros de apoio. */
const VALIDADE_DO_INDICE_MS = 5 * 60 * 1000;

/**
 * Onde o plano de contas mora no IXC: a tabela `planejamento_analitico`, que é
 * para onde o `fn_apagar.id_conta` aponta. O nome do registro vem numa coluna
 * de mesmo nome da tabela.
 *
 * Os outros nomes ficam na lista porque versões diferentes do IXC podem tê-los,
 * e a documentação do webservice não fecha o assunto — mas nenhum deles existe
 * nesta base, e enquanto era só por eles que se procurava, a categoria de
 * despesa aparecia sem nome em toda tela.
 */
const TABELAS_PLANO_DE_CONTAS = [
  'planejamento_analitico',
  'fn_classificacao',
  'plano_contas',
  'fn_plano_contas',
  'fn_conta',
  'conta_despesa',
] as const;

/**
 * Que tipos de conta entram no índice de nomes.
 *
 * "D" é despesa, "P" é a conta do fornecedor e "R" é receita — juntos, tudo que
 * uma conta a pagar pode referenciar (uns três mil registros). O tipo "A", de
 * cliente, fica de fora: são quinze mil que nunca aparecem numa conta a pagar,
 * e lê-los a cada cinco minutos seria uma varredura inteira do IXC para nada.
 */
const TIPOS_DE_CONTA_NO_INDICE = ['D', 'P', 'R'] as const;

/**
 * Conta em texto o que ficou de fora, por motivo e por coluna.
 *
 * "Pago" não vira aviso: título quitado sair da lista de contas em aberto é o
 * esperado, e dizer isso a cada leitura seria ruído. Cancelamento e quitação
 * por saldo viram, porque é neles que um filtro errado se esconde — foi um
 * deles que engoliu quatrocentos títulos de uma vez sem ninguém perceber.
 */
function explicarExclusoes(
  excluidos: Map<string, number>,
  totalLido: number,
): string[] {
  const avisos: string[] = [];

  for (const [chave, quantidade] of excluidos) {
    const [motivo, campo] = chave.split('|');
    if (motivo === 'pago') continue;

    const parte = ((quantidade / Math.max(totalLido, 1)) * 100).toFixed(0);
    if (motivo === 'cancelado') {
      avisos.push(
        `${quantidade} de ${totalLido} título(s) ficaram de fora por estarem ` +
          `cancelados no IXC (coluna "${campo}"). Se essas contas ainda são ` +
          `devidas, é essa coluna que está sendo lida errado — ela responde ` +
          `por ${parte}% do que o IXC devolveu.`,
      );
    } else if (motivo === 'nao-liberado') {
      avisos.push(
        `${quantidade} de ${totalLido} título(s) ficaram de fora por não terem ` +
          `sido liberados no IXC (coluna "liberado" = N) — são lançamentos que ` +
          `a entrada de nota criou e ninguém liberou. Eles também não aparecem ` +
          `na tela de contas a pagar do IXC. Se esse número crescer muito, é ` +
          `sinal de que esta regra está pegando conta demais.`,
      );
    } else if (motivo === 'quitado') {
      avisos.push(
        `${quantidade} título(s) vieram sem saldo a pagar e ficaram de fora.`,
      );
    }
  }

  return avisos;
}

/**
 * As contas a pagar em aberto da empresa, lidas do IXC na hora.
 *
 * Não há cópia local de propósito: conta em aberto é o estado mais volátil que
 * existe no financeiro — alguém paga uma no caixa e ela deixa de ser devida no
 * mesmo minuto. Um espelho aqui estaria errado na maior parte do dia, e um
 * número errado sobre quanto se deve é pior que número nenhum.
 */
@Injectable()
export class ContasAbertasService {
  private readonly logger = new Logger(ContasAbertasService.name);

  /** Nome dos fornecedores, guardado por alguns minutos entre uma tela e outra. */
  private indiceFornecedores: { em: number; nomes: Map<number, string> } | null =
    null;

  /** O mesmo para o plano de contas, que dá nome à categoria da despesa. */
  private indiceCategorias: { em: number; nomes: Map<number, string> } | null =
    null;

  constructor(
    private readonly ixc: IxcClient,
    private readonly prisma: PrismaService,
    private readonly categorias: CategoriasService,
  ) {}

  async listar(): Promise<ContasAbertasResposta> {
    const avisos: string[] = [];

    const brutos = await this.ixc.listAll<Record<string, unknown>>(
      'fn_apagar',
      {
        // "A" é aberto. A conferência de novo acontece no `estaEmAberto`: base
        // que ignore o filtro devolve tudo, e aí é aqui que a conta paga cai
        // fora.
        qtype: 'fn_apagar.status',
        query: 'A',
        oper: '=',
        sortname: 'fn_apagar.data_vencimento',
        sortorder: 'asc',
      },
      { pageSize: 500, maxPages: TETO_DE_TITULOS / 500 },
    );

    if (brutos.length >= TETO_DE_TITULOS) {
      avisos.push(
        `A lista parou em ${TETO_DE_TITULOS} títulos. Há mais contas em aberto ` +
          'no IXC do que cabe nesta tela — os totais abaixo são só do que veio.',
      );
    }

    const hoje = new Date();

    // Cada título que fica de fora é contado pelo motivo e pela coluna que
    // decidiu. É o que faz um filtro errado aparecer na tela em vez de sumir
    // com a dívida caladamente — foi assim que se descobriu que uma regra
    // larga demais tinha engolido quatrocentos títulos de verdade.
    const excluidos = new Map<string, number>();
    const contas: ContaAberta[] = [];

    for (const raw of brutos) {
      const fora = motivoDeNaoEstarAberto(raw);
      if (fora) {
        const chave = `${fora.motivo}|${fora.campo}`;
        excluidos.set(chave, (excluidos.get(chave) ?? 0) + 1);
        continue;
      }
      const conta = mapContaAberta(raw, hoje);
      if (conta) contas.push(conta);
    }

    avisos.push(...explicarExclusoes(excluidos, brutos.length));

    await this.completarNomes(contas, avisos);
    await this.completarCategorias(contas);
    await this.aplicarClassificacoes(contas);
    await this.marcarOrigemNaFolha(contas);

    return {
      contas: ordenarPorUrgencia(contas),
      resumo: resumirContasAbertas(contas),
      lidoEm: hoje,
      avisos,
    };
  }

  /**
   * Quanto a empresa já pagou no mês, lido do IXC.
   *
   * É todo o dinheiro que saiu pelo contas a pagar — inclusive o que nasceu na
   * folha, porque salário, diária e avulso viram `fn_apagar` como qualquer
   * outra despesa. Sem isto o painel só sabe dizer o que falta pagar, e "quanto
   * saiu este mês" é metade da pergunta de quem cuida do caixa.
   *
   * A busca vai por páginas, da mais recente para a mais antiga, e para assim
   * que uma página inteira cai antes do mês pedido: o histórico de pagas cresce
   * para sempre, e lê-lo todo a cada abertura de tela seria pedir ao IXC anos
   * de dados para somar trinta dias.
   */
  async pagasNoMes(mes?: string): Promise<PagamentosDoMes> {
    const alvo = mes ?? mesAtual();
    const lidoEm = new Date();
    let total = 0;
    let quantidade = 0;
    let paginasLidas = 0;

    /*
     * O status de conta paga varia por instalação do IXC: nesta base é "F"
     * (34 mil títulos), e "P" não existe em nenhum. Procurar só por "P" era o
     * que fazia o painel dizer "R$ 0,00 pago neste mês" com o mês inteiro já
     * pago. Os dois são consultados; um título não tem dois status, então não
     * há risco de contar duas vezes.
     *
     * A lista mora no mapper, e não aqui, porque a tela de histórico de
     * pagamentos precisa da mesma resposta: duas cópias dela discordando faria
     * o total do mês no painel bater com uma tela e não com a outra.
     */
    for (const status of STATUS_DE_PAGO) {
      for (let pagina = 1; pagina <= TETO_DE_PAGINAS_PAGAS; pagina++) {
        const res = await this.ixc.list<Record<string, unknown>>('fn_apagar', {
          qtype: 'fn_apagar.status',
          query: status,
          oper: '=',
          page: pagina,
          rp: 500,
          sortname: 'fn_apagar.data_pagamento',
          sortorder: 'desc',
        });
        paginasLidas = Math.max(paginasLidas, pagina);
        if (res.registros.length === 0) break;

        let algumaDoMes = false;
        let algumaMaisNova = false;

        for (const raw of res.registros) {
          // A situação é conferida registro a registro: base que ignore o
          // filtro devolve tudo, e aí seria o mês inteiro somado errado.
          const situacao = lerSituacaoContaPagar(raw);
          if (!situacao.pago || !situacao.dataPagamento) continue;

          const mesDoPagamento = mesDaData(situacao.dataPagamento);
          if (mesDoPagamento === alvo) {
            algumaDoMes = true;
            total += situacao.valorPago;
            quantidade += 1;
          } else if (mesDoPagamento > alvo) {
            // Pagamento posterior ao mês pedido: ainda não chegamos nele.
            algumaMaisNova = true;
          }
        }

        // A página inteira ficou antes do mês pedido: como a ordem é da mais
        // recente para a mais antiga, o que vem depois é mais antigo ainda.
        if (!algumaDoMes && !algumaMaisNova) break;
      }
    }

    if (paginasLidas >= TETO_DE_PAGINAS_PAGAS) {
      this.logger.warn(
        `A leitura de pagamentos de ${alvo} parou em ${TETO_DE_PAGINAS_PAGAS} ` +
          'páginas — o total do mês pode estar incompleto.',
      );
    }

    return {
      mes: alvo,
      total: Math.round(total * 100) / 100,
      quantidade,
      lidoEm,
      completo: paginasLidas < TETO_DE_PAGINAS_PAGAS,
    };
  }

  /**
   * O registro do `fn_apagar` como o IXC o devolve, campo por campo.
   *
   * Existe para responder "por que esta conta aparece (ou não) aqui?" sem
   * chute. O nome das colunas do IXC muda entre versões e a documentação não
   * fecha a lista — duas vezes o filtro desta tela errou por isso, e nas duas
   * a resposta estava num campo que ninguém conseguia ver. Agora dá para ver.
   */
  async registroBruto(idFnApagar: number): Promise<DetalheDoTitulo> {
    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      idFnApagar,
    );
    if (!raw) {
      // A listagem trouxe o título, mas perguntando pelo código o IXC não
      // devolve nada. Vale dizer isso por extenso: é a diferença entre "a
      // conta existe e o filtro daqui erra" e "o IXC devolveu na lista algo
      // que ele mesmo não reconhece" — e são consertos completamente
      // diferentes.
      throw new NotFoundException(
        `A lista trouxe o título ${idFnApagar}, mas ao perguntar por ele pelo ` +
          `código o IXC não devolve nada. Ou seja: ele veio na listagem e não ` +
          `existe mais no cadastro — o problema está do lado do IXC, não do ` +
          `filtro desta tela.`,
      );
    }
    return { campos: raw, filtro: explicarFiltro(raw) };
  }

  /**
   * Preenche o nome de quem vai receber, quando o próprio `fn_apagar` não o
   * trouxe.
   *
   * Muitas bases já devolvem o nome na listagem, e aí isto não custa consulta
   * nenhuma. Onde não vem, o cadastro de fornecedores é lido inteiro uma vez e
   * fica guardado por alguns minutos — é uma consulta a mais por tela, não uma
   * por conta, que numa lista de centenas de títulos seria a tela inteira
   * parada esperando o IXC.
   */
  private async completarNomes(
    contas: ContaAberta[],
    avisos: string[],
  ): Promise<void> {
    const faltando = contas.filter(
      (c) => !c.fornecedor.nome && c.fornecedor.id !== null,
    );
    if (faltando.length === 0) return;

    let nomes: Map<number, string>;
    try {
      nomes = await this.nomesDosFornecedores();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Não deu para ler os fornecedores: ${message}`);
      avisos.push(
        'Não consegui ler o cadastro de fornecedores do IXC, então algumas ' +
          'contas aparecem sem o nome de quem recebe.',
      );
      return;
    }

    for (const conta of faltando) {
      conta.fornecedor.nome =
        nomes.get(conta.fornecedor.id!) ?? `Fornecedor ${conta.fornecedor.id}`;
    }
  }

  /**
   * Dá nome à conta de despesa de cada título — "terreno", "veículos",
   * "energia" —, que é o eixo do gráfico de com o que a empresa está devendo.
   *
   * O `fn_apagar` costuma trazer só o código. O plano de contas mora numa
   * tabela cujo nome muda de uma versão do IXC para outra e não está fechado na
   * documentação, então os nomes conhecidos são testados um a um, como já se
   * faz com a tabela de dados bancários. Nenhum respondendo, o gráfico agrupa
   * pelo código — menos legível, mas ainda verdadeiro.
   */
  private async completarCategorias(contas: ContaAberta[]): Promise<void> {
    const semNome = contas.filter(
      (c) => !c.categoria.nome && c.categoria.id !== null,
    );
    if (semNome.length === 0) return;

    const nomes = await this.nomesDasContasDeDespesa();
    for (const conta of semNome) {
      conta.categoria.nome = nomes.get(conta.categoria.id!) ?? null;
    }
  }

  /**
   * As contas de onde o dinheiro sai — banco e caixa —, lidas do IXC.
   *
   * As quatro do topo são as que de fato pagam as contas da empresa; o resto do
   * cadastro continua disponível, mas embaixo. Sem essa separação, escolher a
   * conta seria caçar quatro nomes no meio de dezessete, quase todos de contas
   * que a empresa não usa mais.
   */
  async contasDePagamento(): Promise<ContaDePagamento[]> {
    const registros = await this.ixc.listAll<Record<string, unknown>>(
      'contas',
      { qtype: 'contas.id', query: '0', oper: '>' },
      { pageSize: 200, maxPages: 3 },
    );

    return registros
      .map((r) => {
        const id = Number(r.id);
        return {
          id,
          nome: String(r.conta ?? r.descricao ?? `Conta ${id}`).trim(),
          ativa: String(r.ativo ?? 'S').toUpperCase() !== 'N',
          usual: CONTAS_QUE_COSTUMAM_PAGAR.includes(id),
        };
      })
      .filter((c) => Number.isInteger(c.id) && c.id > 0 && c.nome)
      .sort((a, b) => {
        if (a.usual !== b.usual) return a.usual ? -1 : 1;
        if (a.ativa !== b.ativa) return a.ativa ? -1 : 1;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      });
  }

  /**
   * As contas de despesa do IXC, para a tela mostrar o nome em vez do código
   * solto — "324" não diz nada a ninguém, e escolher outra conta às cegas era
   * como se fazia até agora.
   *
   * Só as de despesa (tipo "D"): são as 165 que fazem sentido num pagamento. As
   * de cliente e de fornecedor existem no mesmo cadastro, aos milhares, e
   * oferecê-las aqui seria oferecer a conta errada com o mesmo destaque da
   * certa.
   */
  async planoDeContas(): Promise<Array<{ id: number; nome: string }>> {
    for (const tabela of TABELAS_PLANO_DE_CONTAS) {
      try {
        const registros = await this.ixc.listAll<Record<string, unknown>>(
          tabela,
          { qtype: `${tabela}.tipo`, query: 'D', oper: '=' },
          { pageSize: 500, maxPages: 4 },
        );
        const contas = registros
          .filter((r) => String(r.ativo ?? 'S').toUpperCase() !== 'N')
          .map((r) => ({ id: Number(r.id), nome: nomeDaConta(r, tabela) }))
          .filter((c) => Number.isInteger(c.id) && c.id > 0 && c.nome);

        if (contas.length > 0) {
          return contas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        }
      } catch {
        continue;
      }
    }

    this.logger.warn(
      'Nenhuma tabela de plano de contas respondeu — a tela vai ficar só com a ' +
        'conta padrão das Configurações.',
    );
    return [];
  }

  /**
   * Nome das contas de despesa por código, guardado por alguns minutos.
   *
   * Público porque a tela de histórico de pagamentos precisa do mesmo índice —
   * é o mesmo plano de contas, e quem sabe em que tabela desta base ele mora é
   * este serviço. Uma segunda cópia leria o IXC de novo e poderia mostrar nome
   * diferente para o mesmo código enquanto um dos caches estivesse velho.
   */
  async nomesDasContasDeDespesa(): Promise<Map<number, string>> {
    const agora = Date.now();
    if (
      this.indiceCategorias &&
      agora - this.indiceCategorias.em < VALIDADE_DO_INDICE_MS
    ) {
      return this.indiceCategorias.nomes;
    }

    const nomes = new Map<number, string>();
    for (const tabela of TABELAS_PLANO_DE_CONTAS) {
      try {
        // Por tipo, e não a tabela toda: aqui são três mil registros em vez de
        // dezoito mil, e os quinze mil que ficam de fora são contas de cliente,
        // que conta a pagar nenhuma usa.
        for (const tipo of TIPOS_DE_CONTA_NO_INDICE) {
          const registros = await this.ixc.listAll<Record<string, unknown>>(
            tabela,
            { qtype: `${tabela}.tipo`, query: tipo, oper: '=' },
            { pageSize: 500, maxPages: 10 },
          );
          for (const raw of registros) {
            const id = Number(raw.id);
            const nome = nomeDaConta(raw, tabela);
            if (Number.isInteger(id) && id > 0 && nome) nomes.set(id, nome);
          }
        }
        if (nomes.size > 0) {
          this.logger.log(
            `Plano de contas lido de "${tabela}": ${nomes.size} contas.`,
          );
          break;
        }
      } catch {
        // Tabela que esta base não tem: passa para o próximo nome conhecido.
        continue;
      }
    }

    if (nomes.size === 0) {
      this.logger.warn(
        'Nenhuma tabela de plano de contas respondeu — o gráfico por ' +
          'categoria vai agrupar pelo código da conta.',
      );
    }

    this.indiceCategorias = { em: agora, nomes };
    return nomes;
  }

  /** O mesmo, para os fornecedores: um índice só, servindo as duas telas. */
  async nomesDosFornecedores(): Promise<Map<number, string>> {
    const agora = Date.now();
    if (
      this.indiceFornecedores &&
      agora - this.indiceFornecedores.em < VALIDADE_DO_INDICE_MS
    ) {
      return this.indiceFornecedores.nomes;
    }

    // Todos, não só os ativos: uma conta antiga em aberto pode ser de
    // fornecedor já desativado, e ela continua sendo devida.
    const registros = await this.ixc.listAll<Record<string, unknown>>(
      'fornecedor',
      { qtype: 'fornecedor.id', query: '0', oper: '>' },
      { pageSize: 500, maxPages: 20 },
    );

    const nomes = new Map<number, string>();
    for (const raw of registros) {
      const id = Number(raw.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      const nome = String(raw.razao ?? raw.fantasia ?? '').trim();
      if (nome) nomes.set(id, nome);
    }

    this.indiceFornecedores = { em: agora, nomes };
    this.logger.log(`Índice de fornecedores refeito: ${nomes.size} nomes.`);
    return nomes;
  }

  /**
   * Cola em cada título a etiqueta de "com o que se gastou", que é nossa e
   * mora só deste lado — o IXC não tem onde receber isso.
   */
  private async aplicarClassificacoes(contas: ContaAberta[]): Promise<void> {
    const etiquetas = await this.categorias.dosTitulos(
      contas.map((c) => c.idFnApagar),
    );
    for (const conta of contas) {
      const categoria = etiquetas.get(conta.idFnApagar);
      if (categoria) {
        conta.classificacao = categoria;
      }
    }
  }

  /**
   * Marca as contas que nasceram aqui. A mesma dívida aparece nas duas telas —
   * é uma só, e o IXC é quem a guarda —, então o selo existe para ninguém
   * achar que a folha está sendo cobrada duas vezes.
   */
  private async marcarOrigemNaFolha(contas: ContaAberta[]): Promise<void> {
    const ids = contas.map((c) => c.idFnApagar);
    if (ids.length === 0) return;

    const nossas = await this.prisma.contaPagar.findMany({
      where: {
        idFnApagarIxc: { in: ids },
        // Despesa lançada aqui no Contas a Pagar não vem da folha, e dizer que
        // veio é confundir os dois módulos: um é o que a empresa deve, o outro
        // é o que ela paga a quem trabalha nela. O selo existe justamente para
        // separar as duas coisas.
        tipo: { not: TipoLancamento.DESPESA },
      },
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
    for (const conta of contas) {
      const nossa = porFnApagar.get(conta.idFnApagar);
      if (!nossa) continue;
      conta.origem = {
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
