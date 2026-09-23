import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IxcClient } from './ixc.client';
import { parseIxcDate, parseIxcDecimal, parseIxcId } from './ixc.parse';
import {
  acharCaixaPorNome,
  buildLancamentoSaida,
  conferirLancamento,
  detectarCamposMovimento,
  mapCaixa,
  TABELAS_CONTAS_CAIXA,
  TABELAS_MOVIMENTO_CAIXA,
  TABELAS_MOVIMENTO_LEITURA,
  TABELA_MOVIM_FINAN,
  CAMPOS_MOVIM_FINAN,
  type CaixaIxc,
  type CamposMovimento,
  type LancamentoCaixaInput,
} from './ixc.caixa';

/**
 * Quanto tempo um "não achei" continua valendo. Achar vale para sempre — nome
 * de tabela não muda sozinho. Não achar quase nunca é definitivo: o IXC estava
 * fora do ar, a tabela acabou de ganhar o primeiro lançamento, o suporte
 * liberou a permissão agora. Guardar o fracasso pelo resto da vida do processo
 * transformaria o "Lançar no caixa" da tela em enfeite — ele repetiria o mesmo
 * erro sem sequer falar com o IXC. Um minuto absorve a rajada de um pagamento
 * só e já passou quando alguém vai ao IXC e volta.
 */
const FRACASSO_VALE_MS = 60_000;

/** Um lançamento do caixa, do jeito que a conferência precisa vê-lo. */
export interface LancamentoDoCaixa {
  /** Id na tabela de movimento do IXC */
  id: number;
  data: Date;
  /** Sempre positivo; o sinal está no `tipo`. */
  valor: number;
  historico: string;
  tipo: 'ENTRADA' | 'SAIDA';
}

/** Onde o dinheiro em mãos saiu — ou por que não deu para lançar. */
export interface ResultadoLancamentoCaixa {
  /** Tabela do IXC que recebeu o lançamento. */
  tabela: string;
  /** Id do lançamento criado. */
  id: number;
  /** Preenchido quando gravou mas algo não conferiu: peça para olhar no IXC. */
  aviso?: string;
}

/**
 * O caixa do IXC (Financeiro > Movimentação > Financeira). Serve para duas
 * coisas: listar os caixas — para a configuração achar o "CX - Werick" — e
 * lançar a saída do dinheiro pago em mãos.
 *
 * Nenhum dos dois nomes de tabela está na documentação pública do webservice,
 * então são descobertos por consulta (que não altera nada) e podem ser fixados
 * na configuração. E o lançamento só é escrito quando existe um registro real
 * naquela tabela para copiar os nomes das colunas: sem modelo, o app recusa
 * escrever e manda a diária para "lançar no IXC à mão". Ver [[project]].
 */
@Injectable()
export class CaixaService {
  private readonly logger = new Logger(CaixaService.name);

  /** undefined = ainda não procurou; null = procurou e não achou. */
  private tabelaContas: string | null | undefined;
  private tabelaMovimento: string | null | undefined;
  /** A de leitura tem cache próprio: a lista de candidatas é outra. */
  private tabelaLeitura: string | null | undefined;
  private campos: CamposMovimento | null | undefined;
  /** Quando cada "não achei" foi guardado, para saber quando está velho. */
  private naoAchei = { contas: 0, movimento: 0, leitura: 0, campos: 0 };
  /** O que o IXC respondeu na última busca que não achou nada. */
  private ultimaFalha: string | null = null;

  constructor(private readonly ixc: IxcClient) {}

  /** Esquece o que foi descoberto (usado quando a configuração muda). */
  reset(): void {
    this.tabelaContas = undefined;
    this.tabelaMovimento = undefined;
    this.tabelaLeitura = undefined;
    this.campos = undefined;
    this.naoAchei = { contas: 0, movimento: 0, leitura: 0, campos: 0 };
    this.ultimaFalha = null;
  }

  /** Nomes de tabela em uso, para a tela de configuração mostrar. */
  get tabelasEmUso(): { contas: string | null; movimento: string | null } {
    return {
      contas: this.tabelaContas ?? null,
      movimento: this.tabelaMovimento ?? null,
    };
  }

  /**
   * Os caixas/contas cadastrados no IXC. É consulta pura: serve para conferir
   * o código do "CX - Werick" sem ninguém precisar caçar na tela do IXC.
   */
  async listarCaixas(
    tabelaConfigurada?: string | null,
  ): Promise<{ tabela: string | null; caixas: CaixaIxc[] }> {
    const tabela = await this.resolverTabelaContas(tabelaConfigurada);
    if (!tabela) return { tabela: null, caixas: [] };

    try {
      const res = await this.ixc.list<Record<string, unknown>>(tabela, {
        qtype: `${tabela}.id`,
        query: '0',
        oper: '>',
        rp: 500,
        sortname: `${tabela}.id`,
        sortorder: 'asc',
      });
      const caixas = res.registros
        .map(mapCaixa)
        .filter((c): c is CaixaIxc => c !== null);
      return { tabela, caixas };
    } catch (err) {
      this.logger.warn(`Falha ao listar os caixas do IXC: ${mensagem(err)}`);
      return { tabela, caixas: [] };
    }
  }

  /**
   * Código do caixa a usar no pagamento em mãos: o configurado vence; sem ele,
   * procura pelo nome. Retorna null quando não achou — o pagamento continua
   * registrado aqui, só sem a saída no IXC.
   */
  async resolverCaixa(cfg: {
    caixaEmMaosId: number;
    caixaEmMaosNome: string;
    caixaTabelaContas: string;
  }): Promise<number | null> {
    if (cfg.caixaEmMaosId > 0) return cfg.caixaEmMaosId;

    const { caixas } = await this.listarCaixas(cfg.caixaTabelaContas);
    const achado = acharCaixaPorNome(caixas, cfg.caixaEmMaosNome);
    if (achado) {
      this.logger.log(
        `Caixa "${cfg.caixaEmMaosNome}" encontrado no IXC: #${achado.id} (${achado.nome})`,
      );
      return achado.id;
    }
    this.logger.warn(
      `Caixa "${cfg.caixaEmMaosNome}" não encontrado entre ${caixas.length} conta(s) ` +
        'do IXC. Informe o código em Configurações.',
    );
    return null;
  }

  /**
   * Lança a saída do dinheiro no caixa. Lança exceção com um texto que dá para
   * mostrar na tela quando não foi possível — quem chama guarda isso na diária
   * para a pessoa poder tentar de novo ou lançar na mão.
   */
  /**
   * Os lançamentos de um caixa num período, lidos do IXC.
   *
   * O filtro vai pelo caixa, e o recorte de datas é feito aqui depois. Seria
   * melhor pedir os dois ao IXC, mas a consulta dele aceita um campo só por
   * vez, e a coluna de data desta tabela é descoberta — não se sabe de antemão
   * se ela guarda `2026-08-18` ou `18/08/2026`, e comparar a string errada
   * devolveria o período errado calado. Filtrar pelo caixa é exato em qualquer
   * base; o volume de um caixa de dinheiro em mãos cabe nessa leitura.
   */
  async listarLancamentos(
    caixaId: number,
    de: Date,
    ate: Date,
    cfg: { caixaTabelaMovimento: string; caixaTabelaContas?: string },
    opcoes: {
      /**
       * Traz também, qualquer que seja a data, o que tem id acima deste: o
       * lançamento feito depois de um fechamento com data de um dia que ele
       * já assinou. Ver `extrato` em `fechamento-caixa.service`.
       */
      tardiosAcimaDe?: number | null;
    } = {},
  ): Promise<{
    tabela: string;
    lancamentos: LancamentoDoCaixa[];
    /** O maior id que o caixa tem hoje no IXC — null se ele está vazio. */
    maiorId: number | null;
  }> {
    const tardiosAcimaDe = opcoes.tardiosAcimaDe ?? null;
    /*
     * Exceção do Nest, e não `Error` pelado: o que sai daqui vai direto para a
     * tela de quem está batendo o caixa, e `Error` vira "Internal server
     * error" — a pessoa fica com um 500 anônimo no lugar de uma frase que diz
     * o que fazer. (`lancarSaida`, logo abaixo, continua lançando `Error`
     * porque ali quem chama captura e transforma no aviso da diária.)
     */
    const tabela = await this.resolverTabelaLeitura(cfg.caixaTabelaMovimento);
    if (!tabela) {
      throw new ServiceUnavailableException(
        'Não encontrei a tabela da movimentação financeira no seu IXC — é ' +
          'dela que saem os lançamentos do caixa. Informe o nome dela em ' +
          'Configurações.' +
          (this.ultimaFalha
            ? ` (última resposta do IXC: ${this.ultimaFalha})`
            : ''),
      );
    }

    /*
     * O `fn_movim_finan` tem esquema documentado (a coleção do Postman o chama
     * de "Contabilidade"), então ele não passa pela detecção genérica: aquela
     * procura uma coluna `valor`, que aqui não existe — o dinheiro está em
     * `debito` e `credito` —, desistiria, e a tela receberia "não achei o
     * formato" numa tabela que está perfeitamente legível.
     */
    const daContabilidade = tabela === TABELA_MOVIM_FINAN;
    const campos = daContabilidade
      ? CAMPOS_MOVIM_FINAN
      : await this.resolverCampos(tabela);
    if (!campos) {
      throw new ServiceUnavailableException(
        `A tabela "${tabela}" respondeu, mas não achei nela um lançamento de ` +
          'onde copiar o formato das colunas (caixa, valor, data e ' +
          'histórico). Faça um lançamento à mão no IXC e tente de novo.',
      );
    }

    /*
     * A linha do dinheiro traz o **razão** do caixa em `id_conta`, não o id do
     * caixa: é assim que a conciliação acha a perna do pagamento, e foi por
     * confundir os dois que os pagamentos deste app sumiram dela em 758a992.
     * Filtrar pelo id do caixa aqui devolveria lista vazia, calada.
     */
    let chave = caixaId;
    if (daContabilidade) {
      const razao = await this.razaoDoCaixa(caixaId, cfg);
      if (razao === null) {
        throw new ServiceUnavailableException(
          `O caixa #${caixaId} não tem conta do razão no cadastro do IXC ` +
            '(`contas.id_planejamento`), e é por ela que a movimentação se ' +
            'liga a ele. Abra o cadastro da conta no IXC e informe o ' +
            'planejamento dela.',
        );
      }
      chave = razao;
    }

    // O fim do dia entra: quem escolhe "até 18/08" quer o que aconteceu no dia
    // 18, e a data do IXC pode vir com hora.
    const inicio = new Date(de);
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(ate);
    fim.setHours(23, 59, 59, 999);

    /*
     * Ler de trás para frente e parar cedo, em vez de trazer a conta inteira.
     *
     * A primeira versão pedia até 20 mil linhas (quarenta páginas em sequência)
     * para recortar dezoito dias em memória, e o resultado foi 502: o razão de
     * uma conta movimentada não é pequeno — a conciliação registra 135 mil
     * lançamentos no da Conta ModoBank PIX —, e quarenta idas ao IXC estouram
     * o tempo do proxy antes de terminar.
     *
     * Do mais novo para o mais velho, uma página que caia inteira antes do
     * início do período encerra a leitura: o que vem depois dela é mais antigo
     * ainda. Para o recorte de sempre — este mês, a semana passada — são uma ou
     * duas páginas.
     *
     * O corte é pela data, e não pelo id, mas quem ordena é o id: lançamento
     * retroativo nasce com id alto e data velha, então aparece cedo nesta
     * caminhada e é filtrado pela data — nunca fica para trás de uma parada
     * antecipada. É o mesmo desenho da leitura de baixas em
     * `historico-pagamentos`.
     */
    const PAGINA = 200;
    const TETO_DE_PAGINAS = 25;
    const brutos: Array<Record<string, unknown>> = [];

    for (let pagina = 1; pagina <= TETO_DE_PAGINAS; pagina++) {
      const res = await this.ixc.list<Record<string, unknown>>(tabela, {
        qtype: `${tabela}.${campos.caixa}`,
        query: String(chave),
        oper: '=',
        sortname: `${tabela}.id`,
        sortorder: 'desc',
        page: pagina,
        rp: PAGINA,
      });

      if (res.registros.length === 0) break;
      brutos.push(...res.registros);

      const datas = res.registros
        .map((r) => parseIxcDate(r[campos.data]))
        .filter((d): d is Date => d !== null);
      // Página inteira anterior ao início: daqui para trás só há mais antigo.
      // Menos se ainda há lançamento tardio pela frente: ele tem data velha e
      // id alto, e é pelo id que se para de procurá-lo.
      const ultimoId = parseIxcId(res.registros[res.registros.length - 1].id);
      const aindaHaTardio =
        tardiosAcimaDe !== null && ultimoId !== null && ultimoId > tardiosAcimaDe;
      if (datas.length > 0 && datas.every((d) => d < inicio) && !aindaHaTardio)
        break;
      if (res.registros.length < PAGINA) break;
    }

    const lancamentos = brutos
      .map((raw): LancamentoDoCaixa | null => {
        const id = parseIxcId(raw.id);
        const data = parseIxcDate(raw[campos.data]);
        if (id === null || !data) return null;

        let valor: number;
        let saida: boolean;

        if (daContabilidade) {
          /*
           * Partida dobrada: caixa é conta de ativo, então o que entra é
           * débito e o que sai é crédito. A linha preenche um lado só — a que
           * não preenche nenhum não é movimento de dinheiro e cai fora.
           */
          const debito = parseIxcDecimal(raw.debito);
          const credito = parseIxcDecimal(raw.credito);
          if (Math.abs(debito) < 0.005 && Math.abs(credito) < 0.005) return null;
          saida = Math.abs(credito) >= 0.005;
          valor = saida ? credito : debito;
        } else {
          valor = parseIxcDecimal(raw[campos.valor]);
          const cru = campos.tipo ? String(raw[campos.tipo] ?? '').trim() : '';
          // Sem coluna de tipo, quem diz é o sinal do valor.
          saida = campos.tipo ? /^(s|saída|saida)$/i.test(cru) : valor < 0;
        }

        return {
          id,
          data,
          valor: Math.abs(valor),
          historico: String(raw[campos.historico] ?? '').trim(),
          tipo: saida ? 'SAIDA' : 'ENTRADA',
        };
      })
      .filter((l): l is LancamentoDoCaixa => l !== null)
      .filter(
        (l) =>
          l.data <= fim &&
          (l.data >= inicio ||
            (tardiosAcimaDe !== null && l.id > tardiosAcimaDe)),
      )
      .sort((a, b) => a.data.getTime() - b.data.getTime() || a.id - b.id);

    const ids = brutos
      .map((r) => parseIxcId(r.id))
      .filter((id): id is number => id !== null);
    const maiorId = ids.length > 0 ? Math.max(...ids) : null;

    return { tabela, lancamentos, maiorId };
  }

  /** A conta do razão de um caixa (`contas.id_planejamento`). */
  private async razaoDoCaixa(
    caixaId: number,
    cfg: { caixaTabelaContas?: string },
  ): Promise<number | null> {
    const { caixas } = await this.listarCaixas(cfg.caixaTabelaContas);
    return caixas.find((c) => c.id === caixaId)?.razaoId ?? null;
  }

  /**
   * O que a descoberta achou nesta base, para quando a leitura do caixa falha.
   *
   * Nome de tabela e de coluna não estão documentados e variam por instalação,
   * então quando algo não vem a primeira pergunta é sempre a mesma: em que
   * tabela ele foi olhar, e que colunas achou lá. Sem isto a resposta depende
   * de alguém abrir o log do servidor.
   */
  async diagnostico(cfg: {
    caixaTabelaContas: string;
    caixaTabelaMovimento: string;
  }): Promise<{
    tabelaContas: string | null;
    tabelaMovimento: string | null;
    campos: CamposMovimento | null;
    /** Colunas do primeiro lançamento, para conferir a olho. */
    colunasDoModelo: string[];
    ultimaFalha: string | null;
  }> {
    const tabelaContas = await this.resolverTabelaContas(cfg.caixaTabelaContas);
    const tabelaMovimento = await this.resolverTabelaLeitura(
      cfg.caixaTabelaMovimento,
    );

    let campos: CamposMovimento | null = null;
    let colunasDoModelo: string[] = [];
    if (tabelaMovimento) {
      campos = await this.resolverCampos(tabelaMovimento);
      try {
        const res = await this.ixc.list<Record<string, unknown>>(
          tabelaMovimento,
          {
            qtype: `${tabelaMovimento}.id`,
            query: '0',
            oper: '>',
            rp: 1,
            sortname: `${tabelaMovimento}.id`,
            sortorder: 'desc',
          },
        );
        colunasDoModelo = Object.keys(res.registros[0] ?? {});
      } catch {
        colunasDoModelo = [];
      }
    }

    return {
      tabelaContas,
      tabelaMovimento,
      campos,
      colunasDoModelo,
      ultimaFalha: this.ultimaFalha,
    };
  }

  async lancarSaida(
    input: LancamentoCaixaInput,
    cfg: { caixaTabelaMovimento: string },
  ): Promise<ResultadoLancamentoCaixa> {
    const tabela = await this.resolverTabelaMovimento(cfg.caixaTabelaMovimento);
    if (!tabela) {
      throw new Error(
        'Não encontrei a tabela da movimentação financeira no seu IXC. ' +
          'Peça o nome dela ao suporte do IXC e informe em Configurações — ' +
          'até lá, lance a saída na mão.' +
          // Sem isto, "não achei a tabela" engole "não consegui falar com o
          // IXC", e a pessoa liga para o suporte perguntando o nome de uma
          // tabela quando o problema era o host, o token ou a rede.
          (this.ultimaFalha
            ? ` (última resposta do IXC: ${this.ultimaFalha})`
            : ''),
      );
    }

    const campos = await this.resolverCampos(tabela);
    if (!campos) {
      throw new Error(
        `A tabela "${tabela}" não tem um lançamento existente para eu copiar o ` +
          'formato (caixa, valor, data e histórico). Faça um lançamento na mão ' +
          'no IXC e tente de novo — a partir do segundo eu consigo sozinho.',
      );
    }

    const body = buildLancamentoSaida(campos, input);
    const { id } = await this.ixc.create(tabela, body);
    if (!id) {
      throw new Error(`O IXC não devolveu o id do lançamento em "${tabela}"`);
    }

    // Escrever em tabela descoberta por tentativa pede conferência: relê o
    // registro e compara com o que se pediu.
    const gravado = await this.ixc
      .getById<Record<string, unknown>>(tabela, `${tabela}.id`, id)
      .catch(() => null);
    const conferido = conferirLancamento(gravado, campos, input);

    this.logger.log(
      `Saída de ${input.valor} lançada no caixa #${input.caixaId} ` +
        `(${tabela} #${id})${conferido.ok ? '' : ' — com aviso'}`,
    );
    return {
      tabela,
      id,
      aviso: conferido.ok
        ? undefined
        : `Lançamento ${id} criado, mas ${conferido.motivo}. Confira no IXC.`,
    };
  }

  // -------------------------------------------------------------------------
  // Descoberta dos nomes (uma vez por processo)
  // -------------------------------------------------------------------------
  private async resolverTabelaContas(
    configurada?: string | null,
  ): Promise<string | null> {
    const fixa = (configurada ?? '').trim();
    if (fixa && fixa !== this.tabelaContas) this.tabelaContas = undefined;

    const lembrado = this.lembrado(this.tabelaContas, this.naoAchei.contas);
    if (lembrado !== undefined) return lembrado;

    this.tabelaContas = await this.primeiraQueResponde(
      fixa ? [fixa] : TABELAS_CONTAS_CAIXA,
      'contas/caixas',
    );
    if (this.tabelaContas === null) this.naoAchei.contas = Date.now();
    return this.tabelaContas;
  }

  /**
   * A tabela de onde se leem os lançamentos. Separada da de escrita de
   * propósito — ver `TABELAS_MOVIMENTO_LEITURA`.
   */
  private async resolverTabelaLeitura(
    configurada?: string | null,
  ): Promise<string | null> {
    const fixa = (configurada ?? '').trim();
    if (fixa && fixa !== this.tabelaLeitura) {
      this.tabelaLeitura = undefined;
      this.campos = undefined;
    }

    const lembrado = this.lembrado(this.tabelaLeitura, this.naoAchei.leitura);
    if (lembrado !== undefined) return lembrado;

    this.tabelaLeitura = await this.primeiraQueResponde(
      fixa ? [fixa] : TABELAS_MOVIMENTO_LEITURA,
      'movimentação financeira (leitura)',
    );
    if (this.tabelaLeitura === null) this.naoAchei.leitura = Date.now();
    return this.tabelaLeitura;
  }

  private async resolverTabelaMovimento(
    configurada?: string | null,
  ): Promise<string | null> {
    const fixa = (configurada ?? '').trim();
    if (fixa && fixa !== this.tabelaMovimento) {
      this.tabelaMovimento = undefined;
      this.campos = undefined;
    }

    const lembrado = this.lembrado(
      this.tabelaMovimento,
      this.naoAchei.movimento,
    );
    if (lembrado !== undefined) return lembrado;

    this.tabelaMovimento = await this.primeiraQueResponde(
      fixa ? [fixa] : TABELAS_MOVIMENTO_CAIXA,
      'movimentação financeira',
    );
    if (this.tabelaMovimento === null) this.naoAchei.movimento = Date.now();
    return this.tabelaMovimento;
  }

  /**
   * O que está lembrado — ou `undefined`, "vá procurar de novo", quando o que
   * está lembrado é um "não achei" que já passou da validade.
   */
  private lembrado<T>(
    valor: T | null | undefined,
    desde: number,
  ): T | null | undefined {
    if (valor !== null) return valor;
    return Date.now() - desde < FRACASSO_VALE_MS ? null : undefined;
  }

  /** Tabela que respondeu a uma consulta simples (existe nesta base). */
  private async primeiraQueResponde(
    candidatas: string[],
    oQue: string,
  ): Promise<string | null> {
    let ultimoErro: string | null = null;
    for (const tabela of candidatas) {
      try {
        await this.ixc.list<Record<string, unknown>>(tabela, {
          qtype: `${tabela}.id`,
          query: '0',
          oper: '>',
          rp: 1,
        });
        this.logger.log(`Tabela de ${oQue} no IXC: "${tabela}"`);
        this.ultimaFalha = null;
        return tabela;
      } catch (err) {
        // Não existe nesta base — ou o IXC não respondeu. Guarda o motivo: a
        // diferença entre "essa tabela não existe" e "não falei com o IXC" é
        // toda a diferença para quem vai ler o erro na tela, e as duas chegam
        // aqui do mesmo jeito.
        ultimoErro = mensagem(err);
      }
    }
    this.ultimaFalha = ultimoErro;
    this.logger.warn(
      `Tabela de ${oQue} não encontrada. Tentadas: ${candidatas.join(', ')}. ` +
        `Última resposta do IXC: ${ultimoErro ?? '—'}`,
    );
    return null;
  }

  /** Colunas do lançamento, copiadas de um registro que já existe. */
  private async resolverCampos(
    tabela: string,
  ): Promise<CamposMovimento | null> {
    const lembrado = this.lembrado(this.campos, this.naoAchei.campos);
    if (lembrado !== undefined) return lembrado;
    try {
      const res = await this.ixc.list<Record<string, unknown>>(tabela, {
        qtype: `${tabela}.id`,
        query: '0',
        oper: '>',
        rp: 1,
        sortname: `${tabela}.id`,
        sortorder: 'desc',
      });
      const modelo = res.registros[0];
      this.campos = modelo ? detectarCamposMovimento(modelo) : null;
      if (this.campos) {
        this.logger.log(
          `Lançamento no caixa usará as colunas ${JSON.stringify(this.campos)}`,
        );
      } else {
        this.naoAchei.campos = Date.now();
        this.logger.warn(
          `Não consegui deduzir as colunas do lançamento em "${tabela}"`,
        );
      }
      return this.campos;
    } catch (err) {
      this.logger.warn(`Falha ao ler o modelo de lançamento: ${mensagem(err)}`);
      this.campos = null;
      this.naoAchei.campos = Date.now();
      return null;
    }
  }
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
