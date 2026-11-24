/**
 * A análise de risco que vem com a OS — o que a tela do técnico mostra dela e
 * a trava da finalização, sem banco nem IXC, para ser conferido campo a campo.
 *
 * Pedido de 24/11/2026: o técnico não abre APR solta. Cada OS que o IXC
 * encaminha a ele traz a sua; ao liberar, o PDF vai para a aba "Arquivos" da
 * OS no IXC; e a OS só se finaliza pelo celular com a APR liberada e anexada.
 */

import type { StatusApr } from '@prisma/client';
import { assuntoForaDaConferencia } from './conferencia';

/**
 * A OS deste assunto pede APR? Todas, menos as de escritório — as mesmas que
 * já ficam fora da conferência (a pós-venda e a "Conferencia de contrato e
 * Gerar financeiro"), que não têm poste nem escada.
 */
export function osPedeApr(nomeDoAssunto: string | null | undefined): boolean {
  return !assuntoForaDaConferencia(nomeDoAssunto);
}

/** A APR de uma OS como o banco a guarda — só o que a tela e a trava olham. */
export interface AprGuardada {
  id: string;
  numero: number;
  status: StatusApr;
  criadoPorId: string | null;
  criadoPorNome: string;
  arquivoNaOsIxcId: number | null;
  arquivoNaOsErro: string | null;
}

/** As colunas de `aprs` que montam a `AprGuardada`. */
export const COLUNAS_DA_APR_DA_OS = {
  id: true,
  numero: true,
  status: true,
  osIxcId: true,
  criadoPorId: true,
  criadoPorNome: true,
  arquivoNaOsIxcId: true,
  arquivoNaOsErro: true,
} as const;

/** FALTA: ninguém começou. RASCUNHO: em preenchimento. LIBERADA: valendo. */
export type SituacaoDaAprDaOs = 'FALTA' | 'RASCUNHO' | 'LIBERADA';

/** A APR da OS, como a tela do técnico a mostra. */
export interface AprDaOs {
  situacao: SituacaoDaAprDaOs;
  /** Null enquanto ninguém começou a preencher. */
  id: string | null;
  numero: number | null;
  /** O PDF já está na aba "Arquivos" da OS no IXC. */
  naOs: boolean;
  /** Por que o último envio do PDF à OS não foi. */
  erro: string | null;
  /** Quem a abriu, quando não foi quem está olhando — a OS mudou de mãos. */
  deOutro: string | null;
  /** Por que a OS ainda não se finaliza por causa da APR. Null: pode. */
  trava: string | null;
}

/**
 * Por que a OS não se finaliza por causa da APR — ou null, quando ela está
 * liberada e já nos arquivos da OS no IXC.
 *
 * Liberada e não anexada também trava: o que se pediu é a APR nos arquivos da
 * OS, e a OS fechada sem ela é justamente a que ninguém mais vai abrir.
 */
export function travaDaApr(apr: AprGuardada | null): string | null {
  if (!apr || apr.status === 'CANCELADA') {
    return 'Falta a análise de risco desta OS. Preencha e libere a APR antes de finalizar.';
  }
  if (apr.status === 'RASCUNHO') {
    return (
      `A APR nº ${apr.numero} desta OS ainda não foi liberada. Termine de preencher, ` +
      'colha as assinaturas e libere antes de finalizar.'
    );
  }
  if (!apr.arquivoNaOsIxcId) {
    return (
      `A APR nº ${apr.numero} foi liberada, mas ainda não chegou aos arquivos da OS no IXC. ` +
      'Toque em "Enviar à OS", na análise de risco da OS, e finalize depois.'
    );
  }
  return null;
}

/** A APR da OS para a tela de quem entrou (`loginId`). */
export function aprDaOs(apr: AprGuardada | null, loginId: string): AprDaOs {
  const valendo = apr && apr.status !== 'CANCELADA' ? apr : null;
  return {
    situacao: valendo ? (valendo.status === 'LIBERADA' ? 'LIBERADA' : 'RASCUNHO') : 'FALTA',
    id: valendo?.id ?? null,
    numero: valendo?.numero ?? null,
    naOs: !!valendo?.arquivoNaOsIxcId,
    erro: valendo && !valendo.arquivoNaOsIxcId ? valendo.arquivoNaOsErro : null,
    deOutro: valendo && valendo.criadoPorId !== loginId ? valendo.criadoPorNome : null,
    trava: travaDaApr(valendo),
  };
}
