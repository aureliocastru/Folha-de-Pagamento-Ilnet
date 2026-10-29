import type { Tom } from '../components/ui';

/**
 * As ordens de serviço, do lado da tela: os tipos que a API devolve
 * (`apps/api/src/os`) e as palavras de cada situação.
 */

export type TipoItemDeOs = 'INSTALADO' | 'RETIRADO' | 'MATERIAL' | 'DIVERGENCIA';
export type SituacaoItemDeOs = 'PENDENTE' | 'GRAVANDO' | 'GRAVADO' | 'FALHOU' | 'CONFERIR';
export type CondicaoDoRetirado = 'FUNCIONANDO' | 'DEFEITO' | 'NAO_TESTADO';

export interface ItemDeOs {
  id: string;
  tipo: TipoItemDeOs;
  situacao: SituacaoItemDeOs;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  valorUnitario: number | null;
  patrimonioId: number | null;
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
  comodatoIxcId: number | null;
  movimentoIxcId: number | null;
  condicao: CondicaoDoRetirado | null;
  observacao: string | null;
  erro: string | null;
  aviso: string | null;
  tentativas: number;
  gravadoEm: string | null;
  recebidoEm: string | null;
  recebidoPor: string | null;
  destinoAlmox: string | null;
  tecnico: string;
  almoxarifado: string;
  registradoPor: string;
  criadoEm: string;
}

/** A prioridade da OS no IXC: baixa, normal, alta, crítica. */
export type PrioridadeDaOs = 'B' | 'N' | 'A' | 'C';

/** O tipo de serviço, tirado do assunto pela API — é o que ordena a lista do técnico. */
export type TipoDeOs =
  | 'SEM_INTERNET'
  | 'INSTALACAO'
  | 'MUDANCA_DE_ENDERECO'
  | 'MUDANCA_DE_TITULARIDADE'
  | 'OUTROS';

export interface OsNaLista {
  id: number;
  protocolo: string | null;
  status: string;
  statusNome: string;
  prioridade: PrioridadeDaOs | null;
  assunto: string | null;
  tipo: TipoDeOs;
  cliente: string | null;
  endereco: string | null;
  abertura: string | null;
  agenda: string | null;
  recusa: string | null;
  anotados: number;
  pendentes: number;
  problemas: number;
  /** A finalização pelo celular, quando houve. */
  finalizacao: SituacaoItemDeOs | null;
}

/** A OS finalizada pelo celular — e a fila de levar isso ao IXC. */
export interface FinalizacaoDeOs {
  id: string;
  situacao: SituacaoItemDeOs;
  respostaId: number | null;
  resposta: string | null;
  diagnosticoId: number | null;
  diagnostico: string | null;
  relato: string;
  /** Quem assinou — a assinatura está nos arquivos da OS no IXC. */
  assinadaPor: string | null;
  /** Por que o cliente não assinou. */
  semAssinatura: string | null;
  inicio: string;
  fim: string;
  geraComissao: boolean;
  latitude: number | null;
  longitude: number | null;
  precisao: number | null;
  erro: string | null;
  aviso: string | null;
  tentativas: number;
  gravadoEm: string | null;
  tecnico: string;
  registradoPor: string;
  criadoEm: string;
}

/** Um arquivo na aba "Arquivos" da OS, no IXC — é para lá que a foto vai. */
export interface ArquivoDaOs {
  id: number;
  descricao: string;
  /** P foto, A assinatura do cliente, O o PDF que o IXC gera ao finalizar pelo app dele. */
  classificacao: string | null;
}

/** A descrição que o IXC dá à assinatura; a daqui começa igual e leva o nome de quem assinou. */
const DESCRICAO_DA_ASSINATURA = 'Assinatura do Cliente';

/** A assinatura do cliente: a do app do IXC (classificação A) ou a daqui. */
export function ehAssinatura(a: ArquivoDaOs): boolean {
  return (
    a.classificacao === 'A' ||
    a.descricao.trim().toLowerCase().startsWith(DESCRICAO_DA_ASSINATURA.toLowerCase())
  );
}

/** Quem assinou, pela descrição "Assinatura do Cliente — Fulano". Null na do IXC, que não diz. */
export function quemAssinou(a: ArquivoDaOs): string | null {
  const nome = a.descricao.split(' — ').slice(1).join(' — ').trim();
  return nome || null;
}

/** O que o passo a passo de finalizar precisa para abrir. */
export interface ParaFinalizar {
  assunto: {
    nome: string;
    aparelhosExigidos: number;
    produtosExigidos: number;
    /** Zero = não exige; o técnico anexa quantas quiser. */
    fotosExigidas: number;
    /** Sem ela a OS não fecha; no assunto que não a exige, o técnico diz por que não houve. */
    assinaturaObrigatoria: boolean;
  };
  /** Por que esta OS não se finaliza pelo celular. */
  recusa: string | null;
  finalizacao: FinalizacaoDeOs | null;
}

export interface ResultadoDaFinalizacao {
  finalizacao: FinalizacaoDeOs;
  itens: ResultadoDaGravacao;
}

export interface MinhasOs {
  tecnico: { nome: string; almox: { id: number; nome: string } };
  os: OsNaLista[];
}

export interface ComodatoParaRetirar {
  comodatoId: number;
  produtoId: number;
  produto: string;
  quantidade: number;
  patrimonioId: number | null;
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
  desde: string | null;
  motivo: string | null;
}

export interface AparelhoParaInstalar {
  patrimonioId: number;
  produtoId: number;
  descricao: string;
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
  motivo: string | null;
}

export interface MaterialDaVan {
  produtoId: number;
  descricao: string;
  unidade: string | null;
  saldo: number;
  livre: number;
  maximoPorOs: number | null;
  jaNestaOs: number;
}

export interface OsAberta {
  os: OsNaLista & { mensagem: string | null; contratoId: number; clienteId: number };
  tecnico: { nome: string; almox: { id: number; nome: string } };
  paraRetirar: ComodatoParaRetirar[];
  paraInstalar: AparelhoParaInstalar[];
  /** A base ainda não marcou nenhum modelo como aparelho de cliente. */
  semListaDeAparelhos: boolean;
  finalizacao: FinalizacaoDeOs | null;
  materiais: MaterialDaVan[];
  itens: ItemDeOs[];
}

/** Um telefone do cliente, do jeito que a API da ficha o manda. */
export interface TelefoneDoCliente {
  /** De onde ele veio: "Celular", "WhatsApp", "Na mensagem da OS"… */
  rotulo: string;
  /** Como está escrito no cadastro — é o que se lê e se confere. */
  numero: string;
  /** Só os dígitos, para montar o link de ligar e o do WhatsApp. */
  digitos: string;
}

export interface ClienteDaFicha {
  id: number;
  nome: string;
  /** F pessoa física, J jurídica. */
  tipoPessoa: string | null;
  documento: string | null;
  telefones: TelefoneDoCliente[];
  email: string | null;
  contato: string | null;
  /** O aviso que pisca no IXC ao abrir o cliente. */
  alerta: string | null;
  observacao: string | null;
}

export interface EnderecoDaFicha {
  /** A linha que a lista do técnico já mostra: rua, número, bairro, referência. */
  linha: string | null;
  /** Vêm nulos quando já estão escritos na linha — a API não repete. */
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  referencia: string | null;
  coordenada: { latitude: number; longitude: number } | null;
}

export interface ContratoDaFicha {
  id: number;
  plano: string | null;
  status: string | null;
  statusNome: string | null;
  ativacao: string | null;
  observacao: string | null;
}

export interface LoginDaFicha {
  id: number;
  usuario: string | null;
  ativo: boolean;
  online: boolean;
  ip: string | null;
  mac: string | null;
  onu: string | null;
  /** A caixa de atendimento e a porta onde a fibra do cliente termina. */
  caixa: string | null;
  porta: string | null;
  ultimaConexao: string | null;
  sinal: string | null;
}

/**
 * A ficha da OS: as mesmas informações do papel que o IXC imprime
 * ("matricial modelo 1"), mais o telefone para ligar e o ponto no mapa.
 */
export interface FichaDaOs {
  os: {
    id: number;
    protocolo: string | null;
    status: string;
    statusNome: string;
    prioridade: PrioridadeDaOs | null;
    assunto: string | null;
    abertura: string | null;
    agenda: string | null;
    mensagem: string | null;
    filial: string | null;
  };
  cliente: ClienteDaFicha | null;
  endereco: EnderecoDaFicha;
  contrato: ContratoDaFicha | null;
  login: LoginDaFicha | null;
}

export interface PecaAchada {
  patrimonioId: number;
  produtoId: number;
  descricao: string;
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
  almoxId: number;
  almoxarifado: string;
  situacao: string;
  podeMover: boolean;
  impedimento: string | null;
}

export interface ResultadoDaGravacao {
  gravados: number;
  falharam: number;
  conferir: number;
  avisos: number;
}

export interface RegistroDeOs {
  id: string;
  osIxcId: number;
  protocolo: string | null;
  assunto: string | null;
  cliente: string | null;
  endereco: string | null;
  tecnicos: string[];
  atualizadoEm: string;
  anotados: number;
  pendentes: number;
  problemas: number;
  itens: ItemDeOs[];
  finalizacao: FinalizacaoDeOs | null;
}

export interface Recolhido extends ItemDeOs {
  osIxcId: number;
  cliente: string | null;
  tecnicoId: string;
  dias: number;
}

export interface ResultadoDoRecebimento {
  recebidos: number;
  destino: string | null;
  transferencias: number[];
  recusados: Array<{ itemId: string; descricao: string; motivo: string }>;
}

export type AlmoxDoTecnico =
  | { ok: true; almoxId: number; nome: string; filialId: number; origem: 'fixado' | 'padrao' | 'unico' }
  | { ok: false; motivo: string; candidatos: Array<{ id: number; nome: string }> };

export interface TecnicoNaLista {
  funcionarioId: string;
  nome: string;
  ixcId: number | null;
  almox: AlmoxDoTecnico;
  fixado: boolean;
}

export interface VanDoTecnico {
  tecnico: { funcionarioId: string; nome: string; almox: { id: number; nome: string } };
  aparelhos: Array<
    AparelhoParaInstalar & {
      recolhido: { osIxcId: number; cliente: string | null; dias: number } | null;
    }
  >;
  materiais: Array<{
    produtoId: number;
    descricao: string;
    unidade: string | null;
    saldo: number;
    noCatalogo: boolean;
  }>;
  lidoEm: string;
}

export interface MaterialDeOs {
  id: string;
  produtoId: number;
  descricao: string;
  unidade: string | null;
  /** Modelo de aparelho de cliente (vai em comodato), e não material que se gasta. */
  aparelho: boolean;
  maximoPorOs: number | null;
  ativo: boolean;
  ordem: number;
}

export interface ProdutoParaIncluir {
  produtoId: number;
  descricao: string;
  unidade: string | null;
  total: number;
  naLista: boolean;
}

export interface MaterialNoRelatorio {
  produtoId: number;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  valor: number;
  os: number;
  mediaPorOs: number;
}

export interface RelatorioDoMes {
  competencia: string;
  totais: {
    os: number;
    instalados: number;
    retirados: number;
    comDefeito: number;
    divergencias: number;
    valorMateriais: number;
  };
  porTecnico: Array<{
    tecnicoId: string;
    tecnico: string;
    os: number;
    instalados: number;
    retirados: number;
    comDefeito: number;
    divergencias: number;
    valorMateriais: number;
    materiais: MaterialNoRelatorio[];
  }>;
  materiais: Array<MaterialNoRelatorio & { porTecnico: Array<{ tecnico: string; quantidade: number }> }>;
  aparelhos: Array<{
    produtoId: number | null;
    descricao: string;
    instalados: number;
    retirados: number;
    comDefeito: number;
  }>;
  justificativas: Array<{
    osIxcId: number;
    tecnico: string;
    descricao: string;
    quantidade: number;
    unidade: string | null;
    observacao: string;
  }>;
}

export const TIPO_LABEL: Record<TipoItemDeOs, string> = {
  INSTALADO: 'Instalado',
  RETIRADO: 'Retirado',
  MATERIAL: 'Material',
  DIVERGENCIA: 'Fora da lista',
};

export const TIPO_TOM: Record<TipoItemDeOs, Tom> = {
  INSTALADO: 'marca',
  RETIRADO: 'info',
  MATERIAL: 'neutro',
  DIVERGENCIA: 'atencao',
};

export const SITUACAO_LABEL: Record<SituacaoItemDeOs, string> = {
  PENDENTE: 'Não enviado',
  GRAVANDO: 'Enviando',
  GRAVADO: 'No IXC',
  FALHOU: 'Recusado',
  CONFERIR: 'Conferir no IXC',
};

export const SITUACAO_TOM: Record<SituacaoItemDeOs, Tom> = {
  PENDENTE: 'atencao',
  GRAVANDO: 'info',
  GRAVADO: 'pago',
  FALHOU: 'erro',
  CONFERIR: 'erro',
};

/** A situação da finalização, dita do jeito da OS e não do item. */
export const FINALIZACAO_LABEL: Record<SituacaoItemDeOs, string> = {
  PENDENTE: 'Finalização pendente',
  GRAVANDO: 'Finalizando',
  GRAVADO: 'Finalizada por aqui',
  FALHOU: 'Finalização recusada',
  CONFERIR: 'Finalização a conferir',
};

export const PRIORIDADE_LABEL: Record<PrioridadeDaOs, string> = {
  C: 'Prioridade crítica',
  A: 'Prioridade alta',
  N: 'Prioridade normal',
  B: 'Prioridade baixa',
};

export const PRIORIDADE_TOM: Record<PrioridadeDaOs, Tom> = {
  C: 'erro',
  A: 'atencao',
  N: 'neutro',
  B: 'neutro',
};

/** Os tipos na ordem em que o técnico atende — a mesma em que a API manda a lista. */
export const TIPO_DE_OS_LABEL: Record<TipoDeOs, string> = {
  SEM_INTERNET: 'Cliente sem internet',
  INSTALACAO: 'Instalação',
  MUDANCA_DE_ENDERECO: 'Mudança de endereço',
  MUDANCA_DE_TITULARIDADE: 'Mudança de titularidade',
  OUTROS: 'Outros',
};

export const CONDICAO_LABEL: Record<CondicaoDoRetirado, string> = {
  FUNCIONANDO: 'Funcionando',
  DEFEITO: 'Com defeito',
  NAO_TESTADO: 'Sem testar',
};

/** "MAC AA:BB… · série X · nº 123" — o que identifica a peça. */
export function identificacaoDaPeca(p: {
  mac: string | null;
  numeroSerie: string | null;
  numeroPatrimonial: string | null;
}): string {
  return [
    p.mac && `MAC ${p.mac}`,
    p.numeroSerie && `série ${p.numeroSerie}`,
    p.numeroPatrimonial && `nº ${p.numeroPatrimonial}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "3 UN", "12,5 M". */
export function quantidadeComUnidade(quantidade: number, unidade: string | null): string {
  const n = quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return unidade ? `${n} ${unidade}` : n;
}

/**
 * "2026-10-29 08:36:15" → "29/10/2026 08:36"; "2025-12-18" → "18/12/2025".
 *
 * Por fatia de texto, e não por `new Date`: a data do IXC vem sem fuso, e
 * passar por `Date` a joga para o dia anterior em quem está a oeste de
 * Greenwich.
 */
export function dataHoraDoIxc(ixc: string | null): string | null {
  if (!ixc) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(ixc);
  if (!m) return ixc;
  const dia = `${m[3]}/${m[2]}/${m[1]}`;
  return m[4] && m[4] + m[5] !== '0000' ? `${dia} ${m[4]}:${m[5]}` : dia;
}

/** "2026-09-24 09:00:00" → "24/09 09:00". */
export function dataHoraCurta(ixc: string | null): string | null {
  if (!ixc) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(ixc);
  if (!m) return ixc;
  return `${m[3]}/${m[2]}` + (m[4] && m[4] + m[5] !== '0000' ? ` ${m[4]}:${m[5]}` : '');
}
