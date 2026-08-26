import { Injectable, Logger } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import { parseIxcDecimal, parseIxcId } from '../ixc/ixc.parse';
import { motivoDeNaoEstarAberto, primeiraData } from './contas-abertas.mapper';

/**
 * Onde um título cai na sequência de parcelas a que ele parece pertencer.
 *
 * "Parece" é a palavra: no IXC uma compra em seis vezes são seis títulos
 * soltos, sem nada que os ligue. Ver `agruparParcelas` para o que se assume.
 */
export interface ParcelaDoTitulo {
  /** A posição deste título na sequência, por vencimento (1 = a primeira). */
  posicao: number;
  total: number;
  pagas: number;
  /** Quantas ainda não foram pagas — inclui esta, quando esta está aberta. */
  faltam: number;
  valor: number;
  primeiroVencimento: Date | null;
  ultimoVencimento: Date | null;
}

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
          sortorder: 'asc',
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
          'títulos no IXC. A contagem de parcelas dele usou só os primeiros.',
      );
    }

    return out;
  }
}

/**
 * Quais títulos são parcelas da mesma coisa — e em que ordem.
 *
 * A regra é a que quem olha a lista já usa de cabeça: **mesmo fornecedor, mesmo
 * valor**. É um palpite, e é o único palpite possível, porque o vínculo não
 * existe no IXC. Ele erra num caso conhecido — dois negócios diferentes de
 * valor igual com a mesma pessoa viram uma sequência só — e por isso a tela diz
 * de onde a contagem saiu, em vez de apresentá-la como um dado do IXC.
 *
 * Título sozinho no seu par (fornecedor, valor) não vira parcela de nada: uma
 * compra à vista não é "parcela 1 de 1".
 *
 * A ordem é por vencimento, que é a ordem em que as parcelas caem. Sem
 * vencimento vai para o fim, pelo código — é o que sobra quando a data falta, e
 * é estável entre duas leituras.
 */
export function agruparParcelas(
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
