/** O que a API da contabilidade devolve, do jeito que a tela usa. */

export type Estado = 'pronto' | 'falta' | 'atencao' | 'lendo' | 'erro' | 'nao_teve';

export interface LinhaDoResumo {
  rotulo: string;
  valor: number | string;
  tipo: 'moeda' | 'numero' | 'texto';
  destaque?: boolean;
}

export interface ArquivoNaTela {
  id: string;
  nome: string;
  tamanho: number;
  createdAt: string;
  detalhe?: string;
}

export interface Vaga {
  chave: string;
  rotulo: string;
  tipo: 'arquivo' | 'valor';
  aceita: string;
  obrigatoria: boolean;
  multiplo: boolean;
  arquivos: ArquivoNaTela[];
  naoTem: boolean;
  motivo: string | null;
  rotuloDoNaoTem: string;
  valor?: number | null;
  grupo?: string;
}

export interface ItemNaTela {
  numero: number;
  titulo: string;
  pedido: string;
  origem: 'ixc' | 'sistema' | 'arquivo' | 'misto';
  podeNaoTer: boolean;
  estado: Estado;
  resumo: LinhaDoResumo[];
  avisos: string[];
  pendencias: string[];
  erro: string | null;
  lidoEm: string | null;
  naoTeve: boolean;
  observacao: string | null;
  vagas: Vaga[];
  temPlanilha: boolean;
  temLista: boolean;
  ajuste: 'contas' | 'lucros' | 'doacoes' | 'link' | null;
}

export interface PacoteNaTela {
  id: string;
  de: string;
  ate: string;
  prazo: string;
  lendo: boolean;
  leituraEm: string | null;
  leituraFimEm: string | null;
  baixadoEm: string | null;
  itens: ItemNaTela[];
  prontos: number;
}

export interface PacoteNaLista {
  id: string;
  de: string;
  ate: string;
  prazo: string;
  leituraEm: string | null;
  leituraFimEm: string | null;
  baixadoEm: string | null;
  lendo: boolean;
}

export interface Comprovante {
  origem: 'ixc' | 'caixa' | 'conta' | 'recibo' | 'rh' | 'pacote';
  id: string;
  nome: string;
}

export interface PagamentoNaLista {
  idFnApagar: number;
  dia: string;
  fornecedor: string;
  fornecedorDocumento: string;
  notaFiscal: string;
  valor: number;
  pago: number;
  conta: string;
  forma: string;
  planoDeContas: string;
  categorias: Array<{ id: string; nome: string }>;
  observacao: string;
  comprovantes: Comprovante[];
  semComprovante: string | null;
}

export type PapelDaConta = 'extrato' | 'aplicacao' | 'maquininha' | 'caixa' | 'ignorar';

export interface Selecao {
  categorias: string[];
  planos: number[];
  fornecedores: Array<{ id: number; nome: string }>;
  sugerida?: boolean;
}

export interface ConfiguracaoNaTela {
  contas: Array<{ id: number; nome: string; tipo: string; ativa: boolean; papel: PapelDaConta; sugerido: boolean }>;
  categorias: Array<{ id: string; nome: string }>;
  planoDeContas: Array<{ id: number; nome: string; tipo: string }>;
  lucros: Selecao;
  doacoes: Selecao;
  link: Selecao;
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** "01/09/2026 a 30/09/2026" vira "Setembro de 2026" quando é o mês inteiro. */
export function nomeDoPeriodo(de: string, ate: string): string {
  const [a, m, d] = de.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  if (d === 1 && ate === `${de.slice(0, 7)}-${String(ultimo).padStart(2, '0')}`) {
    const nome = MESES[m - 1];
    return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${a}`;
  }
  return `${diaBr(de)} a ${diaBr(ate)}`;
}

export function diaBr(dia: string | null | undefined): string {
  if (!dia) return '';
  const [a, m, d] = dia.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** O mês fechado anterior a hoje — o que a contabilidade pede. */
export function mesAnterior(hoje = new Date()): { de: string; ate: string } {
  const a = hoje.getFullYear();
  const m = hoje.getMonth(); // 0-based: o mês anterior em 1-based
  const ano = m === 0 ? a - 1 : a;
  const mes = m === 0 ? 12 : m;
  const ultimo = new Date(ano, mes, 0).getDate();
  const mm = String(mes).padStart(2, '0');
  return { de: `${ano}-${mm}-01`, ate: `${ano}-${mm}-${String(ultimo).padStart(2, '0')}` };
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
