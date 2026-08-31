import { Injectable, Logger } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import { parseIxcDecimal, parseIxcId } from '../ixc/ixc.parse';
import {
  marcacaoDeParcela,
  motivoDeNaoEstarAberto,
  primeiraData,
  type MarcacaoDeParcela,
} from './contas-abertas.mapper';

/**
 * Onde um título cai na sequência de parcelas a que ele parece pertencer.
 *
 * "Parece" é a palavra: no IXC uma compra em seis vezes são seis títulos
 * soltos, sem nada que os ligue. Ver `agruparParcelas` para o que se assume.
 */
export interface ParcelaDoTitulo {
  /** A posição deste título na sequência (1 = a primeira). */
  posicao: number;
  total: number;
  pagas: number;
  /** Quantas ainda não foram pagas — inclui esta, quando esta está aberta. */
  faltam: number;
  valor: number;
  primeiroVencimento: Date | null;
  ultimoVencimento: Date | null;
  /**
   * De onde saiu a contagem — e é a diferença entre um dado e um palpite:
   *
   * - `nota` = está escrito no título, no "Número da nota" do IXC ("29/36");
   * - `observacao` = está escrito na observação, no formato "(3/6)" que esta
   *   casa escreve ao lançar uma nota parcelada;
   * - `deducao` = ninguém escreveu nada, e a sequência foi deduzida de mesmo
   *   fornecedor + mesmo valor. É a única que pode estar errada.
   */
  fonte: FonteDaParcela;
}

export type FonteDaParcela = 'nota' | 'observacao' | 'deducao';

/*
 * A leitura do "29/36" mora no mapper das contas em aberto, e não aqui.
 *
 * Ela deixou de servir só à contagem por fornecedor: a lista de contas
 * mostra a parcela de cada título direto do que está escrito nele, sem
 * depender de consulta nenhuma. Reexportado para quem já a importava daqui.
 */
export type { MarcacaoDeParcela };

export interface ParcelasEncontradas {
  /** `idFnApagar` → o lugar daquele título na sequência. Só os agrupados. */
  titulos: Record<string, ParcelaDoTitulo>;
  avisos: string[];
}

/** Um título do fornecedor, reduzido ao que decide o agrupamento. */
export interface TituloParaAgrupar {
  idFnApagar: number;
  idFornecedor: number;
  valor: number;
  vencimento: Date | null;
  paga: boolean;
  /**
   * A numeração escrita no próprio título ("29/36"), quando ela existe. É o
   * que dispensa deduzir — e o que corrige a dedução quando ela errou.
   */
  marcacao?: MarcacaoDeParcela | null;
}

/**
 * Quantos fornecedores uma consulta aceita. É uma leitura no IXC por
 * fornecedor: a janela de uma categoria tem dez linhas, e o teto está aqui para
 * uma tela nova não transformar um clique em cem consultas.
 */
const TETO_DE_FORNECEDORES = 60;

/** Quantos títulos se lê de cada fornecedor. Passando disso, o aviso conta. */
const TETO_POR_FORNECEDOR = 600;

/** Quantas leituras correm ao mesmo tempo. O IXC é de produção, não é fila. */
const LEITURAS_EM_PARALELO = 4;

/**
 * A sequência de parcelas de que um título faz parte.
 *
 * O IXC não tem parcelamento: uma compra em seis vezes vira seis registros em
 * `fn_apagar`, cada um com o seu vencimento, e nada no registro diz que os seis
 * são a mesma compra. Quem lança pela tela daqui escreve "(3/6)" na observação
 * — mas o que já estava lançado antes, ou o que foi lançado direto no IXC, não
 * tem essa marca. É esse buraco que este serviço tapa.
 *
 * A leitura é por fornecedor, e não por período: parcela paga em janeiro está
 * fora de qualquer janela que a tela de pagamentos abra, e é justamente ela que
 * precisa entrar na conta do "quantas já paguei". Filtrando `fn_apagar` pelo
 * fornecedor vêm as pagas e as abertas de uma vez, que é a pergunta inteira.
 */
@Injectable()
export class ParcelasService {
  private readonly logger = new Logger(ParcelasService.name);

  constructor(private readonly ixc: IxcClient) {}

  async doFornecedores(idsPedidos: number[]): Promise<ParcelasEncontradas> {
    const avisos: string[] = [];
    const ids = [
      ...new Set(idsPedidos.filter((id) => Number.isInteger(id) && id > 0)),
    ];

    if (ids.length > TETO_DE_FORNECEDORES) {
      avisos.push(
        `A contagem parou em ${TETO_DE_FORNECEDORES} fornecedores. As linhas ` +
          'dos demais ficam sem a contagem de parcelas.',
      );
      ids.length = TETO_DE_FORNECEDORES;
    }

    const titulos: TituloParaAgrupar[] = [];

    for (let i = 0; i < ids.length; i += LEITURAS_EM_PARALELO) {
      const lote = ids.slice(i, i + LEITURAS_EM_PARALELO);
      const lidos = await Promise.all(
        lote.map((id) => this.lerDoFornecedor(id, avisos)),
      );
      for (const deles of lidos) titulos.push(...deles);
    }

    return { titulos: agruparParcelas(titulos), avisos };
  }

  /**
   * Os títulos de um fornecedor, pagos e abertos.
   *
   * Falha de leitura não derruba a consulta inteira: o fornecedor fica sem
   * contagem, com o motivo no aviso, e as outras linhas continuam respondendo.
   */
  private async lerDoFornecedor(
    idFornecedor: number,
    avisos: string[],
  ): Promise<TituloParaAgrupar[]> {
    let brutos: Record<string, unknown>[];
    try {
      brutos = await this.ixc.listAll<Record<string, unknown>>(
        'fn_apagar',
        {
          qtype: 'fn_apagar.id_fornecedor',
          query: String(idFornecedor),
          oper: '=',
          sortname: 'fn_apagar.data_vencimento',
          /*
           * Do vencimento mais recente para o mais antigo.
           *
           * Só muda o que é lido quando o fornecedor passa do teto — e aí
           * muda tudo: o banco da empresa tem milhares de títulos, e lendo do
           * começo os seiscentos primeiros eram de anos atrás. O
           * financiamento que ainda está sendo pago ficava de fora, e a conta
           * aparecia sem parcela nenhuma. Quem tem título demais interessa
           * pelo que ainda vai vencer.
           */
          sortorder: 'desc',
        },
        { pageSize: 300, maxPages: TETO_POR_FORNECEDOR / 300 },
      );
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Não deu para ler os títulos do fornecedor ${idFornecedor}: ${motivo}`,
      );
      avisos.push(
        `As parcelas do fornecedor ${idFornecedor} não puderam ser contadas ` +
          `(${motivo}).`,
      );
      return [];
    }

    const out: TituloParaAgrupar[] = [];
    // Base que ignore o filtro devolve os títulos de todo mundo. Conferir o
    // fornecedor de novo aqui é o que impede a contagem de misturar compras de
    // pessoas diferentes — e o descasamento total vira aviso, e não silêncio.
    let deOutros = 0;

    for (const raw of brutos) {
      const idFnApagar = parseIxcId(raw.id);
      if (idFnApagar === null) continue;

      if (parseIxcId(raw.id_fornecedor ?? raw.fornecedor_id) !== idFornecedor) {
        deOutros++;
        continue;
      }

      const fora = motivoDeNaoEstarAberto(raw);
      // Cancelada não é parcela paga nem parcela a pagar: ela deixou de
      // existir. Contá-la em qualquer dos dois lados mentiria nos dois.
      if (
        fora &&
        (fora.motivo === 'cancelado' || fora.motivo === 'nao-liberado')
      ) {
        continue;
      }

      out.push({
        idFnApagar,
        idFornecedor,
        valor: parseIxcDecimal(raw.valor ?? raw.valor_documento),
        vencimento: primeiraData(raw, [
          'data_vencimento',
          'data_venc',
          'vencimento',
          'data_vencimento_original',
        ]),
        paga: fora !== null,
        marcacao: marcacaoDeParcela(raw),
      });
    }

    if (brutos.length > 0 && out.length === 0 && deOutros === brutos.length) {
      avisos.push(
        `O IXC devolveu títulos de outros fornecedores ao filtrar pelo ` +
          `${idFornecedor}: o filtro por fornecedor não pegou nesta base, e ` +
          'por isso as parcelas não foram contadas.',
      );
    }

    if (brutos.length >= TETO_POR_FORNECEDOR) {
      avisos.push(
        `O fornecedor ${idFornecedor} tem mais de ${TETO_POR_FORNECEDOR} ` +
          'títulos no IXC. A contagem de parcelas dele usou os mais recentes; ' +
          'a parcela escrita no próprio título (número da nota) continua ' +
          'valendo para todos.',
      );
    }

    return out;
  }
}

/**
 * Quais títulos são parcelas da mesma coisa — e em que ordem.
 *
 * São dois caminhos, e o primeiro sempre ganha:
 *
 * 1. **está escrito no título.** Financiamento e consórcio chegam ao IXC com a
 *    parcela no "Número da nota" ("29/36"), e o que esta casa lança parcelado
 *    leva "(3/6)" na observação. Aí não há o que deduzir: a numeração é a que
 *    está lá, e o total é o da compra inteira — inclusive as parcelas que
 *    ainda nem foram lançadas no IXC.
 * 2. **não está escrito em lugar nenhum.** Sobra o palpite que quem olha a
 *    lista já faz de cabeça: **mesmo fornecedor, mesmo valor**. Ele erra num
 *    caso conhecido — dois negócios diferentes de valor igual com a mesma
 *    pessoa viram uma sequência só — e é por isso que cada contagem diz de
 *    onde saiu (`fonte`), em vez de se apresentar como um dado do IXC.
 *
 * Foi a mistura dos dois que fazia a Hilux aparecer errada: as trinta e seis
 * parcelas do financiamento não têm todas o mesmo valor (o juro muda a
 * última), então a dedução partia a sequência em pedaços e mostrava "parcela 2
 * de 3" numa conta que o próprio IXC diz ser a 29 de 36.
 *
 * Título sozinho não vira parcela de nada quando é deduzido — uma compra à
 * vista não é "parcela 1 de 1" —, mas vira quando está marcado: um título
 * escrito "29/36" conta a sequência inteira sozinho, mesmo que as outras
 * trinta e cinco não estejam no IXC.
 */
export function agruparParcelas(
  titulos: TituloParaAgrupar[],
): Record<string, ParcelaDoTitulo> {
  const marcados = titulos.filter((t) => t.marcacao);
  const semMarca = titulos.filter((t) => !t.marcacao);

  return {
    ...deduzidas(semMarca),
    // Os marcados por último: título que tem numeração escrita manda sobre
    // qualquer dedução que o tenha alcançado por outro caminho.
    ...marcadas(marcados),
  };
}

/**
 * As sequências que vêm numeradas do IXC.
 *
 * O que junta os títulos aqui é o fornecedor e o **total** declarado, não o
 * valor: parcela de financiamento muda de valor no meio do caminho, e exigir
 * valores iguais partiria a compra em pedaços — que é justamente o defeito que
 * a numeração escrita conserta.
 *
 * `pagas` recebe um piso: um título que se diz a parcela 29 tem, por
 * definição, vinte e oito antes dele. Elas podem não estar no IXC (o
 * financiamento começou antes deste sistema), e contá-las como "a pagar" faria
 * a tela dizer "36 a pagar" numa compra que está no fim. O piso vale como
 * "já passaram", e o que a tela mostra é a soma que fecha: pagas + faltam =
 * total.
 */
function marcadas(
  titulos: TituloParaAgrupar[],
): Record<string, ParcelaDoTitulo> {
  const grupos = new Map<string, TituloParaAgrupar[]>();

  for (const t of titulos) {
    const chave = `${t.idFornecedor}|n${t.marcacao!.total}`;
    const atual = grupos.get(chave);
    if (atual) atual.push(t);
    else grupos.set(chave, [t]);
  }

  const out: Record<string, ParcelaDoTitulo> = {};

  for (const grupo of grupos.values()) {
    const total = grupo[0].marcacao!.total;
    const menorPosicao = Math.min(...grupo.map((t) => t.marcacao!.posicao));
    const pagasNoIxc = grupo.filter((t) => t.paga).length;
    const pagas = Math.min(total, Math.max(pagasNoIxc, menorPosicao - 1));
    const datas = grupo
      .map((t) => t.vencimento)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    for (const t of grupo) {
      out[String(t.idFnApagar)] = {
        posicao: t.marcacao!.posicao,
        total,
        pagas,
        faltam: Math.max(0, total - pagas),
        valor: t.valor,
        primeiroVencimento: datas[0] ?? null,
        ultimoVencimento: datas[datas.length - 1] ?? null,
        fonte: t.marcacao!.fonte,
      };
    }
  }

  return out;
}

/**
 * As sequências deduzidas de mesmo fornecedor + mesmo valor.
 *
 * A ordem é por vencimento, que é a ordem em que as parcelas caem. Sem
 * vencimento vai para o fim, pelo código — é o que sobra quando a data falta, e
 * é estável entre duas leituras.
 */
function deduzidas(
  titulos: TituloParaAgrupar[],
): Record<string, ParcelaDoTitulo> {
  const grupos = new Map<string, TituloParaAgrupar[]>();

  for (const t of titulos) {
    // O valor entra na chave em centavos: comparar float com float separaria
    // parcelas que são o mesmo dinheiro.
    const chave = `${t.idFornecedor}|${Math.round(t.valor * 100)}`;
    const atual = grupos.get(chave);
    if (atual) atual.push(t);
    else grupos.set(chave, [t]);
  }

  const out: Record<string, ParcelaDoTitulo> = {};

  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;

    const ordenados = [...grupo].sort(porVencimento);
    const pagas = ordenados.filter((t) => t.paga).length;
    const datas = ordenados
      .map((t) => t.vencimento)
      .filter((d): d is Date => d !== null);

    ordenados.forEach((t, i) => {
      out[String(t.idFnApagar)] = {
        posicao: i + 1,
        total: ordenados.length,
        pagas,
        faltam: ordenados.length - pagas,
        valor: t.valor,
        primeiroVencimento: datas[0] ?? null,
        ultimoVencimento: datas[datas.length - 1] ?? null,
        fonte: 'deducao',
      };
    });
  }

  return out;
}

function porVencimento(a: TituloParaAgrupar, b: TituloParaAgrupar): number {
  if (a.vencimento && b.vencimento) {
    const d = a.vencimento.getTime() - b.vencimento.getTime();
    return d !== 0 ? d : a.idFnApagar - b.idFnApagar;
  }
  if (a.vencimento) return -1;
  if (b.vencimento) return 1;
  return a.idFnApagar - b.idFnApagar;
}
