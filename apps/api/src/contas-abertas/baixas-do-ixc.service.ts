import { Injectable, Logger } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import {
  colunaDoTitulo,
  mapBaixa,
  ultimaBaixaPorTitulo,
  type BaixaNoIxc,
} from './baixas-do-ixc.mapper';

/**
 * As baixas do IXC — a linha que diz **em que dia o dinheiro saiu**.
 *
 * O histórico de pagamentos lê os títulos (`fn_apagar`), e o título sabe que foi
 * pago mas não sabe quando: `data_pagamento` traz o dia em que a baixa foi
 * registrada. Quem paga pelo aplicativo do banco e só depois vem lançar tem
 * todas as contas com essa diferença, e era ela que fazia a tela acusar atraso
 * em pagamento feito no vencimento.
 *
 * O dia de verdade está na baixa, e não há endpoint documentado para lê-la do
 * lado do pagar: a coleção traz a listagem do lado do receber
 * (`fn_areceber_baixas`, filtrando por `fn_movim_finan.*`) e, do lado do pagar,
 * só o DELETE de estorno — `fn_apagar_baixas/{id_movim_finan}`, que revela o
 * nome do recurso e a tabela por trás dele. Por isso aqui se pergunta ao próprio
 * IXC em vez de confiar num nome: as combinações conhecidas são testadas uma vez
 * e a que responde com linhas reconhecíveis fica guardada.
 *
 * Nada aqui é essencial. Não achando caminho, o histórico segue mostrando a data
 * do título — que é o que ele já fazia — e diz na tela que aquela data é a do
 * lançamento. Um histórico com data aproximada é melhor que histórico nenhum.
 */

/** Onde as baixas moram nesta instalação, e em que formato ela compara datas. */
interface CaminhoDasBaixas {
  /** O recurso do webservice: `fn_apagar_baixas`, por exemplo */
  recurso: string;
  /** A tabela que prefixa o `qtype` — no IXC, a de movimentação financeira */
  tabela: string;
  /** A coluna com o dia informado na baixa */
  colunaData: string;
  /** A coluna que liga a baixa ao título */
  colunaTitulo: string;
  formato: 'iso' | 'br';
}

/**
 * As combinações a testar, na ordem em que valem a pena.
 *
 * `fn_apagar_baixas` vem primeiro porque é o nome que o próprio IXC usa no
 * estorno do pagar. `fn_movim_finan` é o plano B: é a tabela por trás das duas
 * telas de baixa, está documentada como listável, e devolve muito mais que
 * baixas — por isso não é a primeira escolha, e por isso a linha sem coluna de
 * título é descartada em vez de adivinhada.
 */
const RECURSOS = ['fn_apagar_baixas', 'fn_movim_finan'] as const;

/** A tabela que prefixa o `qtype`, como a coleção mostra no lado do receber. */
const TABELA = 'fn_movim_finan';

const PAGINA = 500;

/**
 * Teto de linhas de baixa por leitura. Um mês do provedor tem centenas; o teto
 * existe para um período largo não travar a tela, e o corte é contado em vez de
 * virar um total silenciosamente menor.
 */
const TETO_DE_BAIXAS = 4000;

/**
 * Quantos títulos podem ser perguntados um a um numa leitura.
 *
 * A consulta avulsa é o conserto de quem ficou sem par: título que a janela
 * trouxe mas cuja baixa é de outro dia. São poucos por período — é o lançamento
 * atrasado, não a regra —, e o teto está aqui para o dia em que forem muitos não
 * virar centenas de chamadas ao IXC numa abertura de tela.
 */
export const TETO_DE_BAIXAS_AVULSAS = 120;

/** Por quanto tempo vale o caminho descoberto. */
const VALIDADE_DA_SONDA_MS = 30 * 60 * 1000;

/** O que uma leitura de baixas devolve. */
export interface LeituraDeBaixas {
  /** Deu para ler? Falso = o histórico segue pela data do título. */
  disponivel: boolean;
  /** A última baixa de cada título, pelo id do título. */
  porTitulo: Map<number, BaixaNoIxc>;
  /** Quantas linhas vieram do IXC. */
  lidas: number;
  /** A leitura bateu no teto: há mais baixas no período do que veio. */
  cortado: boolean;
  /** Como foi lido — ou, não dando, por quê. */
  como: string;
}

@Injectable()
export class BaixasDoIxcService {
  private readonly logger = new Logger(BaixasDoIxcService.name);

  /**
   * O que a sonda descobriu. `null` guardado = sondou e nenhum caminho
   * respondeu; aí não se sonda de novo a cada abertura de tela.
   */
  private caminho: { em: number; achado: CaminhoDasBaixas | null } | null = null;

  constructor(private readonly ixc: IxcClient) {}

  /**
   * As baixas de um período, pela data informada nelas.
   *
   * O período é o que se pede e o que se confere: base que ignore o filtro
   * devolve linhas de qualquer dia, e uma baixa de outro mês entrando aqui
   * mudaria a data de um pagamento para o dia errado — que é justamente o erro
   * que este serviço existe para corrigir.
   */
  async daJanela(de: Date, ate: Date): Promise<LeituraDeBaixas> {
    const caminho = await this.descobrirCaminho();
    if (!caminho) {
      return {
        disponivel: false,
        porTitulo: new Map(),
        lidas: 0,
        cortado: false,
        como:
          'Não achei como ler as baixas do IXC nesta base, então a data de ' +
          'cada pagamento é a do título.',
      };
    }

    const baixas: BaixaNoIxc[] = [];
    let pagina = 1;
    let cortado = false;

    try {
      while (baixas.length < TETO_DE_BAIXAS) {
        const res = await this.ixc.list<Record<string, unknown>>(
          caminho.recurso,
          {
            qtype: `${caminho.tabela}.${caminho.colunaData}`,
            query: formatarData(de, caminho.formato),
            oper: '>=',
            sortname: `${caminho.tabela}.${caminho.colunaData}`,
            sortorder: 'asc',
            page: pagina,
            rp: PAGINA,
          },
        );
        if (res.registros.length === 0) break;

        let passouDoFim = false;
        for (const raw of res.registros) {
          const baixa = mapBaixa(raw, caminho.colunaTitulo);
          if (!baixa) continue;
          if (diaCivil(baixa.data) > diaCivil(ate)) {
            passouDoFim = true;
            continue;
          }
          if (diaCivil(baixa.data) < diaCivil(de)) continue;
          baixas.push(baixa);
        }

        // Vindo em ordem crescente, a página que já passou do fim encerra a
        // leitura: o que vem depois dela é mais recente ainda.
        if (passouDoFim) break;
        if (res.registros.length < PAGINA) break;

        pagina += 1;
        if (baixas.length >= TETO_DE_BAIXAS) cortado = true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Não deu para ler as baixas do IXC: ${message}`);
      // O caminho é esquecido: a próxima leitura sonda de novo, porque um
      // recurso que parou de responder não deve ficar guardado como bom.
      this.caminho = null;
      return {
        disponivel: false,
        porTitulo: new Map(),
        lidas: 0,
        cortado: false,
        como: `O IXC não respondeu à leitura das baixas (${message}), então a data de cada pagamento é a do título.`,
      };
    }

    return {
      disponivel: true,
      porTitulo: ultimaBaixaPorTitulo(baixas),
      lidas: baixas.length,
      cortado,
      como:
        `A data de cada pagamento é a informada na baixa, lida de ` +
        `"${caminho.recurso}" pela coluna "${caminho.colunaData}".`,
    };
  }

  /**
   * A última baixa de um título, perguntada por ele.
   *
   * Serve ao título que a janela trouxe e a leitura do período não achou: ou o
   * dinheiro saiu antes do período (o lançamento atrasado, que é o caso comum),
   * ou ele tem baixa que a listagem não devolveu. Nos dois, é a data desta linha
   * que decide em que dia o pagamento entra — e sem perguntar não há como
   * distinguir um do outro.
   *
   * Null = não deu para saber. Nunca lança: isto roda dentro de uma tela de
   * leitura e uma baixa que não veio não pode derrubar o histórico.
   */
  async doTitulo(idFnApagar: number): Promise<BaixaNoIxc | null> {
    const caminho = await this.descobrirCaminho();
    if (!caminho) return null;

    try {
      const res = await this.ixc.list<Record<string, unknown>>(
        caminho.recurso,
        {
          qtype: `${caminho.tabela}.${caminho.colunaTitulo}`,
          query: String(idFnApagar),
          oper: '=',
          rp: 50,
        },
      );

      const baixas = res.registros
        .map((raw) => mapBaixa(raw, caminho.colunaTitulo))
        .filter((b): b is BaixaNoIxc => b !== null)
        // A resposta é conferida: base que ignore o filtro devolveria as baixas
        // de outros títulos, e a data de outro título é pior que data nenhuma.
        .filter((b) => b.idFnApagar === idFnApagar);

      return ultimaBaixaPorTitulo(baixas).get(idFnApagar) ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Não deu para ler as baixas do título ${idFnApagar}: ${message}`,
      );
      return null;
    }
  }

  /**
   * Pergunta ao IXC onde as baixas moram nesta instalação.
   *
   * Cada tentativa é uma listagem de uma linha só, de uma data antiga: o que se
   * mede não é quanto foi pago, é se o recurso existe e se a linha que ele
   * devolve dá para reconhecer — precisa ter a coluna que aponta o título e uma
   * data. Recurso que responda sem isso não serve, mesmo respondendo: seria uma
   * data qualquer colada num pagamento de verdade.
   */
  private async descobrirCaminho(): Promise<CaminhoDasBaixas | null> {
    if (this.caminho && Date.now() - this.caminho.em < VALIDADE_DA_SONDA_MS) {
      return this.caminho.achado;
    }

    // Data velha o bastante para pegar qualquer histórico desta base.
    const marco = new Date(Date.UTC(2000, 0, 1));
    let achado: CaminhoDasBaixas | null = null;

    for (const recurso of RECURSOS) {
      for (const formato of ['br', 'iso'] as const) {
        achado = await this.sondar(recurso, formato, marco);
        if (achado) break;
      }
      if (achado) break;
    }

    if (achado) {
      this.logger.log(
        `Baixas do pagar em "${achado.recurso}": data em ` +
          `"${achado.colunaData}" (formato ${achado.formato}), título em ` +
          `"${achado.colunaTitulo}".`,
      );
    } else {
      this.logger.warn(
        'Nenhum recurso de baixa do pagar respondeu nesta base — o histórico ' +
          'vai mostrar a data em que a baixa foi registrada no título, que ' +
          'pode ser depois do dia em que o dinheiro saiu.',
      );
    }

    this.caminho = { em: Date.now(), achado };
    return achado;
  }

  /** Uma tentativa: este recurso responde, e a linha dele dá para ler? */
  private async sondar(
    recurso: string,
    formato: 'iso' | 'br',
    desde: Date,
  ): Promise<CaminhoDasBaixas | null> {
    let registros: Array<Record<string, unknown>>;
    try {
      const res = await this.ixc.list<Record<string, unknown>>(recurso, {
        qtype: `${TABELA}.data`,
        query: formatarData(desde, formato),
        oper: '>=',
        sortname: `${TABELA}.data`,
        sortorder: 'desc',
        rp: 1,
      });
      registros = res.registros;
    } catch {
      // Recurso que esta instalação não serve, ou formato que ela recusa.
      return null;
    }

    for (const raw of registros) {
      const colunaTitulo = colunaDoTitulo(raw);
      if (!colunaTitulo) continue;
      const baixa = mapBaixa(raw, colunaTitulo);
      if (!baixa) continue;
      return {
        recurso,
        tabela: TABELA,
        colunaData: baixa.campo,
        colunaTitulo,
        formato,
      };
    }
    return null;
  }
}

/** A data no formato que a sonda descobriu que esta base aceita comparar. */
function formatarData(data: Date, formato: 'iso' | 'br'): string {
  const d = String(data.getUTCDate()).padStart(2, '0');
  const m = String(data.getUTCMonth() + 1).padStart(2, '0');
  const y = data.getUTCFullYear();
  return formato === 'iso' ? `${y}-${m}-${d}` : `${d}/${m}/${y}`;
}

function diaCivil(data: Date): number {
  return Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());
}
