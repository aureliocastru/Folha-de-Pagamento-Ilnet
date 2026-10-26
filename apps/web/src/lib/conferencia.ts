import type { Tom } from '../components/ui';
import type { ArquivoDaOs } from './os';

/**
 * A conferência das OS fechadas, pelo chefe do almoxarifado — os tipos que a
 * API devolve (`apps/api/src/os/conferencia.service.ts`).
 */

export type GravidadeDoSinal = 'PROBLEMA' | 'ATENCAO';

/** Um aviso que o sistema viu sozinho na OS. */
export interface Sinal {
  codigo: string;
  gravidade: GravidadeDoSinal;
  texto: string;
}

export type SituacaoDaConferencia = 'CONFERIDA' | 'PROBLEMA' | 'RESOLVIDA';

export interface ConferenciaNaTela {
  situacao: SituacaoDaConferencia;
  teveProblema: boolean;
  motivo: string | null;
  motivoTexto: string | null;
  observacao: string | null;
  conferidaPor: string;
  conferidaEm: string;
  respostaDoTecnico: string | null;
  respondidaEm: string | null;
  resolucao: string | null;
  resolvidaPor: string | null;
  resolvidaEm: string | null;
}

export interface DiaDaFila {
  dia: string;
  total: number;
  conferidas: number;
  problemas: number;
  pendentes: number;
}

export interface FilaDaConferencia {
  dias: DiaDaFila[];
  primeiroPendente: string | null;
  problemasAbertos: number;
}

export interface OsNaConferencia {
  id: number;
  protocolo: string | null;
  dia: string;
  fechamento: string | null;
  tecnicoIxcId: number;
  tecnico: string;
  cliente: string | null;
  assunto: string | null;
  contratoId: number;
  sinais: Sinal[];
  fotos: number;
  erroDeLeitura: string | null;
  conferencia: ConferenciaNaTela | null;
}

export interface DiaNaConferencia {
  dia: string;
  os: OsNaConferencia[];
}

export interface AparelhoDaOs {
  id: number;
  produtoId: number;
  descricao: string | null;
  patrimonioId: number | null;
  numeroPatrimonial: string | null;
  numeroSerie: string | null;
  mac: string | null;
  contratoId: number;
  /** E emprestado, D devolvido. */
  status: string;
}

export interface ComodatoDoContrato {
  comodatoId: number;
  produtoId: number;
  descricao: string | null;
  quantidade: number;
  patrimonioId: number | null;
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
  desde: string | null;
}

export interface Coordenada {
  latitude: number;
  longitude: number;
}

export interface OsParaConferir extends OsNaConferencia {
  endereco: string | null;
  abertura: string | null;
  mensagem: string | null;
  relatorio: string | null;
  arquivos: ArquivoDaOs[];
  aparelhos: AparelhoDaOs[];
  materiais: Array<{ id: number; produtoId: number; descricao: string | null; quantidade: number; unidade: string | null }>;
  comodatoDoContrato: ComodatoDoContrato[];
  /** Onde o celular estava quando a OS fechou. */
  fechamentoGps: (Coordenada & { em: string | null }) | null;
  itensDoApp: Array<{ tipo: string; descricao: string; situacao: string }>;
}

export interface ProblemaNaTela {
  osIxcId: number;
  dia: string;
  tecnicoIxcId: number;
  tecnico: string | null;
  cliente: string | null;
  assunto: string | null;
  motivo: string | null;
  motivoTexto: string | null;
  observacao: string | null;
  conferidaPor: string;
  conferidaEm: string;
  respostaDoTecnico: string | null;
  respondidaEm: string | null;
}

export interface ConferenciaDoMes {
  competencia: string;
  conferidas: number;
  dePrimeira: number;
  comProblema: number;
  abertas: number;
  porTecnico: Array<{
    tecnicoIxcId: number;
    tecnico: string;
    conferidas: number;
    dePrimeira: number;
    comProblema: number;
    abertas: number;
    pctDePrimeira: number;
  }>;
  motivos: Array<{ motivo: string; texto: string; vezes: number }>;
}

/** Os motivos de problema, na ordem em que a tela oferece — os mesmos da API. */
export const MOTIVOS_DE_PROBLEMA: Array<{ codigo: string; texto: string }> = [
  { codigo: 'APARELHO_FORA_DO_COMODATO', texto: 'Aparelho da foto não está no comodato do contrato' },
  { codigo: 'APARELHO_DIFERENTE', texto: 'Série ou MAC da foto não bate com o comodato' },
  { codigo: 'RETIRADA_NAO_BAIXADA', texto: 'Retirada não baixada no contrato' },
  { codigo: 'FALTOU_FOTO', texto: 'Faltou foto, ou a foto não mostra o serviço' },
  { codigo: 'FALTOU_ASSINATURA', texto: 'Faltou a assinatura do cliente' },
  { codigo: 'MATERIAL_ERRADO', texto: 'Material lançado errado' },
  { codigo: 'OUTRO', texto: 'Outro motivo' },
];

export const SITUACAO_DA_CONFERENCIA: Record<SituacaoDaConferencia, { rotulo: string; tom: Tom }> = {
  CONFERIDA: { rotulo: 'Conferida', tom: 'pago' },
  PROBLEMA: { rotulo: 'Com problema', tom: 'erro' },
  RESOLVIDA: { rotulo: 'Resolvida', tom: 'info' },
};

/** "sex., 23/10" — o dia da fila, como se lê. */
export function diaNaTela(dia: string): string {
  const d = new Date(`${dia}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dia;
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

/** "10:42" de "AAAA-MM-DD HH:MM:SS". */
export function horaDoIxc(dataHora: string | null): string {
  return dataHora && dataHora.length >= 16 ? dataHora.slice(11, 16) : '';
}
