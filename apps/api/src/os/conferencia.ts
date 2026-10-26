/**
 * A conferência das OS fechadas, pelo chefe do almoxarifado — o que se lê do
 * IXC para ela e os avisos que o sistema dá sozinho, sem cliente HTTP nenhum,
 * para poder ser conferido campo a campo.
 *
 * O que se conferiu na base em 23 e 26/10/2026, e decide o que está aqui:
 *
 *  - fecham de 37 a 53 OS por dia útil; em 23/10, das 37, só 19 tinham foto e
 *    só 13 tinham aparelho em comodato na própria OS;
 *  - o texto do fechamento está em `su_oss_chamado.mensagem_resposta`;
 *  - o GPS de onde o técnico fechou fica na mensagem de status F
 *    (`su_oss_chamado_mensagem`), em `latitude`, `longitude` e `gps_time`. O
 *    app do IXC grava esse mesmo ponto na OS, no login e quase sempre no
 *    cliente: não há endereço independente para medir a distância — a tela
 *    mostra onde a OS fechou, e quem confere olha o mapa;
 *  - a linha de comodato da OS (`su_oss_mov_comodato_wiz`) traz a peça
 *    (`id_patrimonio`, `numero_serie`, `numero_patrimonial`), o contrato para
 *    onde ela foi (`id_contrato`) e a situação (`status_comodato`: E
 *    emprestado, D devolvido);
 *  - nenhum assunto ativo marca "exige comodato" nem "exige fotos" no IXC — a
 *    instalação se reconhece pelo nome do assunto.
 */

import { numeroDoIxc } from '../almoxarifado/estoque.mapper';
import {
  ehAssinatura,
  lerOs,
  type ArquivoDaOs,
  type AssuntoDoIxc,
  type ComodatoDoContrato,
  type OsDoIxc,
} from './os-ixc';

/** Quantos dias para trás a fila mostra. */
export const DIAS_NA_FILA = 7;

/** Os motivos de uma OS com problema — o código fica guardado; o texto, na tela. */
export const MOTIVOS_DE_PROBLEMA = {
  APARELHO_FORA_DO_COMODATO: 'Aparelho da foto não está no comodato do contrato',
  APARELHO_DIFERENTE: 'Série ou MAC da foto não bate com o comodato',
  RETIRADA_NAO_BAIXADA: 'Retirada não baixada no contrato',
  FALTOU_FOTO: 'Faltou foto, ou a foto não mostra o serviço',
  FALTOU_ASSINATURA: 'Faltou a assinatura do cliente',
  MATERIAL_ERRADO: 'Material lançado errado',
  OUTRO: 'Outro motivo',
} as const;
export type MotivoDeProblema = keyof typeof MOTIVOS_DE_PROBLEMA;

export function ehMotivo(v: unknown): v is MotivoDeProblema {
  return typeof v === 'string' && v in MOTIVOS_DE_PROBLEMA;
}

// ---------------------------------------------------------------------------
// O que se lê do IXC
// ---------------------------------------------------------------------------

export interface Coordenada {
  latitude: number;
  longitude: number;
}

/** A OS fechada, com o que a conferência olha além do que a lista do técnico usa. */
export interface OsFechada extends OsDoIxc {
  /** `mensagem_resposta`: o que o técnico escreveu ao fechar. */
  relatorio: string | null;
}

function texto(v: unknown): string | null {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t === '' || t === '0' ? null : t;
}

/** Uma coordenada que dá para usar: número, dentro do mapa, e não o zero do vazio. */
export function coordenada(latitude: unknown, longitude: unknown): Coordenada | null {
  const lat = Number(String(latitude ?? '').replace(',', '.'));
  const lng = Number(String(longitude ?? '').replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

/** Uma linha de `su_oss_chamado` fechada. Null quando não tem id. */
export function lerOsFechada(l: Record<string, unknown>): OsFechada | null {
  const os = lerOs(l);
  if (!os) return null;
  return { ...os, relatorio: texto(l.mensagem_resposta) };
}

/** O dia em que a OS fechou, "AAAA-MM-DD". */
export function diaDoFechamento(os: Pick<OsDoIxc, 'fechamento'>): string | null {
  return os.fechamento && /^\d{4}-\d{2}-\d{2}/.test(os.fechamento) ? os.fechamento.slice(0, 10) : null;
}

/** Um aparelho que a OS pôs em comodato (`su_oss_mov_comodato_wiz`). */
export interface AparelhoDaOs {
  id: number;
  produtoId: number;
  descricao: string | null;
  patrimonioId: number | null;
  numeroPatrimonial: string | null;
  numeroSerie: string | null;
  mac: string | null;
  /** O contrato para onde a peça foi. */
  contratoId: number;
  /** E emprestado (está com o cliente), D devolvido. */
  status: string;
}

export function lerAparelhoDaOs(l: Record<string, unknown>): AparelhoDaOs | null {
  const id = numeroDoIxc(l.id);
  if (id <= 0) return null;
  const patrimonioId = numeroDoIxc(l.id_patrimonio);
  return {
    id,
    produtoId: numeroDoIxc(l.id_produto),
    descricao: texto(l.descricao),
    patrimonioId: patrimonioId > 0 ? patrimonioId : null,
    numeroPatrimonial: texto(l.numero_patrimonial),
    numeroSerie: texto(l.numero_serie),
    mac: texto(l.mac),
    contratoId: numeroDoIxc(l.id_contrato),
    status: String(l.status_comodato ?? '').trim().toUpperCase(),
  };
}

/** Um material gasto na OS (`movimento_produtos`, fora o comodato). */
export interface MaterialDaOs {
  id: number;
  produtoId: number;
  descricao: string | null;
  quantidade: number;
  unidade: string | null;
}

/** Uma linha de `movimento_produtos` da OS. Null no comodato (P) e na linha sem produto. */
export function lerMaterialDaOs(l: Record<string, unknown>): MaterialDaOs | null {
  if (String(l.tipo_produto ?? '').trim().toUpperCase() === 'P') return null;
  const id = numeroDoIxc(l.id);
  const produtoId = numeroDoIxc(l.id_produto);
  if (id <= 0 || produtoId <= 0) return null;
  return {
    id,
    produtoId,
    descricao: texto(l.descricao),
    quantidade: numeroDoIxc(l.qtde_saida),
    unidade: texto(l.unidade_sigla),
  };
}

/** Onde o celular estava quando a OS fechou: a última mensagem de status F com GPS. */
export function gpsDoFechamento(
  mensagens: Array<Record<string, unknown>>,
): (Coordenada & { em: string | null }) | null {
  for (const m of [...mensagens].reverse()) {
    if (String(m.status ?? '').trim().toUpperCase() !== 'F') continue;
    const c = coordenada(m.latitude, m.longitude);
    if (c) return { ...c, em: texto(m.gps_time) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// O tipo de serviço, pelo nome do assunto
// ---------------------------------------------------------------------------

function normalizado(nome: string | null): string {
  return (nome ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/**
 * O assunto põe aparelho no cliente: "Inst Fibra", "Instalação", "NOVA
 * INSTALAÇÃO RÁDIO", "Migração". O "Inst Aplicativo" é instalar o app no
 * celular do cliente, e não leva aparelho.
 */
export function ehInstalacao(nome: string | null): boolean {
  const n = normalizado(nome);
  return /\binst\b|instala|migra/.test(n) && !/aplicativo/.test(n);
}

/** O assunto tira aparelho do cliente: "RETIRADA DE EQUIPAMENTO". A "Retirada de Cabo", não. */
export function ehRetirada(nome: string | null): boolean {
  return /retirada de equip|recolh/.test(normalizado(nome));
}

// ---------------------------------------------------------------------------
// Os avisos
// ---------------------------------------------------------------------------

/** Problema: algo que deveria estar e não está. Atenção: vale olhar. */
export type GravidadeDoSinal = 'PROBLEMA' | 'ATENCAO';

export interface Sinal {
  codigo:
    | 'SEM_FOTO'
    | 'FOTOS_A_MENOS'
    | 'SEM_ASSINATURA'
    | 'SEM_APARELHO'
    | 'APARELHO_EM_OUTRO_CONTRATO'
    | 'RETIRADA_NAO_BAIXADA'
    | 'ITENS_DO_APP';
  gravidade: GravidadeDoSinal;
  texto: string;
}

/** O que os avisos olham de uma OS. */
export interface DadosParaSinais {
  nomeDoAssunto: string | null;
  assunto: Pick<AssuntoDoIxc, 'fotosExigidas' | 'assinaturaObrigatoria' | 'aparelhosExigidos'> | null;
  contratoId: number;
  arquivos: ArquivoDaOs[];
  aparelhos: AparelhoDaOs[];
  /** O comodato do contrato agora — só lido na retirada. */
  comodatoDoContrato: ComodatoDoContrato[] | null;
  /** Os itens anotados pelo celular daqui que ainda não estão no IXC. */
  itensForaDoIxc: number;
}

/** As fotos da OS: tudo na aba "Arquivos", menos a assinatura e o PDF que o IXC gera ao finalizar (O). */
export function fotosDaOs(arquivos: ArquivoDaOs[]): ArquivoDaOs[] {
  return arquivos.filter((a) => !ehAssinatura(a) && a.classificacao !== 'O');
}

/**
 * O que o sistema vê sozinho numa OS fechada — para o chefe do almoxarifado
 * olhar primeiro onde tem coisa. Nenhum aviso decide nada: é ele quem diz se
 * a OS está certa.
 */
export function sinaisDaOs(d: DadosParaSinais): Sinal[] {
  const sinais: Sinal[] = [];
  const fotos = fotosDaOs(d.arquivos).length;
  const exigidas = d.assunto?.fotosExigidas ?? 0;
  if (fotos === 0) {
    sinais.push({
      codigo: 'SEM_FOTO',
      gravidade: exigidas > 0 ? 'PROBLEMA' : 'ATENCAO',
      texto: 'Sem foto',
    });
  } else if (fotos < exigidas) {
    sinais.push({ codigo: 'FOTOS_A_MENOS', gravidade: 'PROBLEMA', texto: `${fotos} de ${exigidas} fotos` });
  }

  if (d.assunto?.assinaturaObrigatoria && !d.arquivos.some(ehAssinatura)) {
    sinais.push({ codigo: 'SEM_ASSINATURA', gravidade: 'PROBLEMA', texto: 'Sem a assinatura do cliente' });
  }

  const instalados = d.aparelhos.filter((a) => a.status !== 'D');
  if ((ehInstalacao(d.nomeDoAssunto) || (d.assunto?.aparelhosExigidos ?? 0) > 0) && instalados.length === 0) {
    sinais.push({ codigo: 'SEM_APARELHO', gravidade: 'PROBLEMA', texto: 'Nenhum aparelho em comodato na OS' });
  }
  for (const a of d.aparelhos) {
    if (d.contratoId > 0 && a.contratoId > 0 && a.contratoId !== d.contratoId) {
      sinais.push({
        codigo: 'APARELHO_EM_OUTRO_CONTRATO',
        gravidade: 'PROBLEMA',
        texto: `${a.descricao ?? 'Aparelho'} foi para o contrato ${a.contratoId}, e a OS é do ${d.contratoId}`,
      });
    }
  }

  if (ehRetirada(d.nomeDoAssunto) && d.comodatoDoContrato && d.comodatoDoContrato.length > 0) {
    const n = d.comodatoDoContrato.length;
    sinais.push({
      codigo: 'RETIRADA_NAO_BAIXADA',
      gravidade: 'PROBLEMA',
      texto: `Retirada, e o contrato ainda tem ${n} aparelho${n > 1 ? 's' : ''} emprestado${n > 1 ? 's' : ''}`,
    });
  }

  if (d.itensForaDoIxc > 0) {
    sinais.push({
      codigo: 'ITENS_DO_APP',
      gravidade: 'PROBLEMA',
      texto: `${d.itensForaDoIxc} item(ns) anotado(s) no celular não estão no IXC`,
    });
  }

  // Os problemas primeiro.
  return sinais.sort((a, b) => Number(a.gravidade === 'ATENCAO') - Number(b.gravidade === 'ATENCAO'));
}

/** O peso de uma OS na fila: com problema primeiro, depois com atenção, depois o resto. */
export function pesoDosSinais(sinais: Sinal[]): number {
  if (sinais.some((s) => s.gravidade === 'PROBLEMA')) return 0;
  if (sinais.length > 0) return 1;
  return 2;
}

// ---------------------------------------------------------------------------
// O veredito
// ---------------------------------------------------------------------------

export type Veredito = 'CONFERIDA' | 'PROBLEMA';

/** O que o chefe mandou. */
export interface PedidoDeConferencia {
  situacao: Veredito;
  motivo?: string | null;
  observacao?: string | null;
}

/** O veredito faz sentido? Problema pede motivo; "outro motivo" pede a observação. */
export function motivoParaRecusarVeredito(p: PedidoDeConferencia): string | null {
  if (p.situacao !== 'PROBLEMA') return null;
  if (!ehMotivo(p.motivo)) return 'Escolha o motivo do problema.';
  if (p.motivo === 'OUTRO' && (p.observacao ?? '').trim().length < 3) {
    return 'Diga qual é o problema na observação.';
  }
  return null;
}

/**
 * A situação nova. "Conferida" numa OS que estava com problema é o problema
 * resolvido, e não uma conferência de primeira — o relatório conta diferente.
 */
export function situacaoDepois(
  antes: { situacao: 'CONFERIDA' | 'PROBLEMA' | 'RESOLVIDA'; teveProblema: boolean } | null,
  veredito: Veredito,
): { situacao: 'CONFERIDA' | 'PROBLEMA' | 'RESOLVIDA'; teveProblema: boolean } {
  if (veredito === 'PROBLEMA') return { situacao: 'PROBLEMA', teveProblema: true };
  const teveProblema = antes?.teveProblema ?? false;
  return { situacao: teveProblema ? 'RESOLVIDA' : 'CONFERIDA', teveProblema };
}

// ---------------------------------------------------------------------------
// O mês
// ---------------------------------------------------------------------------

export interface ConferenciaNoRelatorio {
  tecnicoIxcId: number;
  tecnico: string | null;
  situacao: 'CONFERIDA' | 'PROBLEMA' | 'RESOLVIDA';
  teveProblema: boolean;
  motivo: string | null;
}

export interface TecnicoNaConferencia {
  tecnicoIxcId: number;
  tecnico: string;
  conferidas: number;
  /** Conferidas sem problema nenhum. */
  dePrimeira: number;
  comProblema: number;
  /** Com problema ainda aberto. */
  abertas: number;
  /** 0 a 100, sem casas. */
  pctDePrimeira: number;
}

export interface ConferenciaDoMes {
  competencia: string;
  conferidas: number;
  dePrimeira: number;
  comProblema: number;
  abertas: number;
  porTecnico: TecnicoNaConferencia[];
  motivos: Array<{ motivo: string; texto: string; vezes: number }>;
}

/** As conferências de um mês, por técnico e por motivo. */
export function resumirConferencias(competencia: string, linhas: ConferenciaNoRelatorio[]): ConferenciaDoMes {
  const porTecnico = new Map<number, TecnicoNaConferencia>();
  const motivos = new Map<string, number>();
  for (const l of linhas) {
    const t = porTecnico.get(l.tecnicoIxcId) ?? {
      tecnicoIxcId: l.tecnicoIxcId,
      tecnico: l.tecnico ?? `Técnico ${l.tecnicoIxcId}`,
      conferidas: 0,
      dePrimeira: 0,
      comProblema: 0,
      abertas: 0,
      pctDePrimeira: 0,
    };
    t.conferidas += 1;
    if (l.teveProblema) t.comProblema += 1;
    else t.dePrimeira += 1;
    if (l.situacao === 'PROBLEMA') t.abertas += 1;
    porTecnico.set(l.tecnicoIxcId, t);
    if (l.teveProblema && l.motivo) motivos.set(l.motivo, (motivos.get(l.motivo) ?? 0) + 1);
  }
  const tecnicos = [...porTecnico.values()]
    .map((t) => ({ ...t, pctDePrimeira: t.conferidas ? Math.round((t.dePrimeira / t.conferidas) * 100) : 0 }))
    .sort((a, b) => a.pctDePrimeira - b.pctDePrimeira || b.conferidas - a.conferidas);
  const soma = (f: (t: TecnicoNaConferencia) => number) => tecnicos.reduce((s, t) => s + f(t), 0);
  return {
    competencia,
    conferidas: soma((t) => t.conferidas),
    dePrimeira: soma((t) => t.dePrimeira),
    comProblema: soma((t) => t.comProblema),
    abertas: soma((t) => t.abertas),
    porTecnico: tecnicos,
    motivos: [...motivos.entries()]
      .map(([motivo, vezes]) => ({
        motivo,
        texto: ehMotivo(motivo) ? MOTIVOS_DE_PROBLEMA[motivo] : motivo,
        vezes,
      }))
      .sort((a, b) => b.vezes - a.vezes),
  };
}

/** "AAAA-MM-DD" válido. */
export function ehDia(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** O dia `n` dias antes (ou depois, com n negativo) de "AAAA-MM-DD". */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
