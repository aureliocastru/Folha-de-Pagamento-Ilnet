import { Injectable, Logger } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import { primeiraData } from './contas-abertas.mapper';
import { ParcelasService } from './parcelas.service';
import { PagamentosService, type EdicaoDoTitulo } from './pagamentos.service';

/** A marca "(3/10)" que esta casa escreve no fim da observação da parcela. */
const MARCA_DA_PARCELA = /\(\d{1,4}\s*\/\s*\d{1,4}\)/g;

/**
 * O que vai igual para todas as parcelas. Fica de fora o que é de cada uma:
 * o código de barras (cada boleto tem o seu), o documento e o "Número da nota"
 * do IXC (nesta base ele guarda a parcela, "16/48"). O número da nota fiscal
 * já vai a todas pelo caminho dele.
 */
const IGUAIS_EM_TODAS = [
  'valor',
  'tipoPagamento',
  'contaPagamento',
  'contaContabil',
  'chavePix',
  'tipoChavePix',
  'idFornecedor',
  'dataEmissao',
  'veiculoId',
] as const satisfies ReadonlyArray<keyof EdicaoDoTitulo>;

/** Como a edição se saiu nas outras parcelas. */
export interface EdicaoNasParcelas {
  atualizadas: number[];
  falhas: Array<{ idFnApagar: number; erro: string }>;
}

/**
 * Editar uma parcela e levar a mesma mudança às outras da compra.
 *
 * "Outras" são as que `irmasNaCompra` reconhece — mesmo fornecedor e a mesma
 * marca de parcela — e que ainda estão em aberto: parcela paga não se edita.
 */
@Injectable()
export class EdicaoNasParcelasService {
  private readonly logger = new Logger(EdicaoNasParcelasService.name);

  constructor(
    private readonly ixc: IxcClient,
    private readonly pagamentos: PagamentosService,
    private readonly parcelas: ParcelasService,
  ) {}

  /** As outras parcelas da compra que ainda dá para editar. */
  async abertasDaCompra(idFnApagar: number): Promise<number[]> {
    const irmas = await this.parcelas.irmasComSituacao(idFnApagar);
    return irmas.filter((t) => !t.paga).map((t) => t.idFnApagar);
  }

  /**
   * Edita a parcela e depois as irmãs, uma a uma. Uma que falhe não desfaz as
   * outras: a resposta diz quais ficaram e por quê.
   */
  async editar(
    idFnApagar: number,
    mudancas: EdicaoDoTitulo,
  ): Promise<Awaited<ReturnType<PagamentosService['editar']>> & { parcelas: EdicaoNasParcelas }> {
    // Lidas antes de mexer: trocar o fornecedor ou a descrição desfaz o que
    // liga as parcelas, e o vencimento de antes é a régua das outras.
    const irmas = await this.abertasDaCompra(idFnApagar);
    const vencimentoAntes = mudancas.dataVencimento
      ? await this.vencimentoDe(idFnApagar)
      : null;

    const editado = await this.pagamentos.editar(idFnApagar, mudancas);

    const parcelas: EdicaoNasParcelas = { atualizadas: [], falhas: [] };
    for (const id of irmas) {
      try {
        const daIrma = await this.mudancasDaIrma(id, mudancas, vencimentoAntes);
        // Só mudou o que é de cada uma (o boleto, o documento): nada a levar.
        if (Object.keys(daIrma).length === 0) continue;
        await this.pagamentos.editar(id, daIrma);
        parcelas.atualizadas.push(id);
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Parcela ${id} (da compra de ${idFnApagar}) não foi editada: ${erro}`);
        parcelas.falhas.push({ idFnApagar: id, erro });
      }
    }
    return { ...editado, parcelas };
  }

  private async mudancasDaIrma(
    id: number,
    mudancas: EdicaoDoTitulo,
    vencimentoAntes: string | null,
  ): Promise<EdicaoDoTitulo> {
    const daIrma: EdicaoDoTitulo = {};
    for (const campo of IGUAIS_EM_TODAS) {
      if (mudancas[campo] !== undefined) Object.assign(daIrma, { [campo]: mudancas[campo] });
    }
    if (mudancas.dataVencimento === undefined && mudancas.observacao === undefined) {
      return daIrma;
    }

    const raw = await this.ixc.getById<Record<string, unknown>>('fn_apagar', 'fn_apagar.id', id);
    if (!raw) throw new Error(`O título ${id} não existe mais no IXC.`);

    if (mudancas.observacao !== undefined) {
      daIrma.observacao = observacaoDaIrma(
        mudancas.observacao,
        String(raw.obs ?? raw.observacao ?? ''),
      );
    }
    if (mudancas.dataVencimento !== undefined && vencimentoAntes) {
      const venc = primeiraData(raw, ['data_vencimento']);
      if (venc) {
        daIrma.dataVencimento = vencimentoDaIrma(
          vencimentoAntes,
          mudancas.dataVencimento,
          venc.toISOString().slice(0, 10),
        );
      }
    }
    return daIrma;
  }

  private async vencimentoDe(id: number): Promise<string | null> {
    const raw = await this.ixc.getById<Record<string, unknown>>('fn_apagar', 'fn_apagar.id', id);
    const venc = raw ? primeiraData(raw, ['data_vencimento']) : null;
    return venc ? venc.toISOString().slice(0, 10) : null;
  }
}

/**
 * O texto novo na parcela irmã: o mesmo, com a marca dela ("(3/10)") no lugar
 * da marca da parcela editada. Sem a marca a irmã deixaria de ser reconhecida
 * como parcela da compra.
 */
export function observacaoDaIrma(nova: string, daIrma: string): string {
  const base = nova.replace(MARCA_DA_PARCELA, '').replace(/\s+/g, ' ').trim();
  const marca = daIrma.match(MARCA_DA_PARCELA)?.at(-1);
  return marca ? `${base} ${marca}`.trim() : base;
}

/**
 * O vencimento novo da parcela irmã, andando como andou o da editada.
 *
 * A parcela mensal que vencia no mesmo dia da editada passa a vencer no dia
 * novo, no mês dela andado o mesmo tanto de meses: de 29/10 para 05/11, a de
 * 29/12 vai para 05/01. As outras (quinzenais) andam os mesmos dias.
 */
export function vencimentoDaIrma(antes: string, depois: string, daIrma: string): string {
  const [ya, ma, da] = antes.split('-').map(Number);
  const [yd, md, dd] = depois.split('-').map(Number);
  const [yi, mi, di] = daIrma.split('-').map(Number);

  if (di !== da) {
    const dias = (Date.UTC(yd, md - 1, dd) - Date.UTC(ya, ma - 1, da)) / 86_400_000;
    return new Date(Date.UTC(yi, mi - 1, di + dias)).toISOString().slice(0, 10);
  }

  const meses = yi * 12 + (mi - 1) + (yd - ya) * 12 + (md - ma);
  const ano = Math.floor(meses / 12);
  const mes = meses % 12;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(dd, ultimoDia))).toISOString().slice(0, 10);
}
