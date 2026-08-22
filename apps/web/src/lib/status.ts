import type { Tom } from '../components/ui';
import type {
  CategoriaItemApr,
  FormaPagamento,
  GravidadeApr,
  PerfilUsuario,
  RespostaRelato,
  SentidoVale,
  StatusApr,
  StatusContaPagar,
  TipoLancamento,
} from './types';

export const STATUS_LABEL: Record<StatusContaPagar, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  APROVADO: 'Aprovado',
  REPROVADO: 'Reprovado',
  AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
  PAGO: 'Pago',
  CANCELADO: 'Cancelado',
  ERRO: 'Erro',
};

/** Cor conta história: verde só quando o banco confirmou. */
export const STATUS_TOM: Record<StatusContaPagar, Tom> = {
  RASCUNHO: 'neutro',
  AGUARDANDO_APROVACAO: 'atencao',
  APROVADO: 'info',
  REPROVADO: 'erro',
  AGUARDANDO_PAGAMENTO: 'info',
  PAGO: 'pago',
  CANCELADO: 'neutro',
  ERRO: 'erro',
};

export const TIPO_LABEL: Record<TipoLancamento, string> = {
  SALARIO: 'Salário',
  FERIAS: 'Férias',
  ADIANTAMENTO: 'Adiantamento',
  BONUS: 'Bônus',
  DESCONTO: 'Desconto',
  AVULSO: 'Avulso',
  DIARIA: 'Diária',
  DESPESA: 'Despesa',
};

/** Por onde o dinheiro sai — vale para diária e para pagamento avulso. */
export const FORMA_PAGAMENTO_LABEL: Record<FormaPagamento, string> = {
  IXC: 'Pelo IXC',
  EM_MAOS: 'Em mãos',
};

/**
 * Quem deve — não o que a folha faz. Sem isso o selo brigava com o "fora da
 * folha" ("Desconta da folha · fora da folha").
 */
export const SENTIDO_LABEL: Record<SentidoVale, string> = {
  DESCONTO: 'Funcionário paga a empresa',
  CREDITO: 'Empresa paga o funcionário',
};

export const SENTIDO_CURTO: Record<SentidoVale, string> = {
  DESCONTO: 'Funcionário deve',
  CREDITO: 'Empresa deve',
};

export const SENTIDO_TOM: Record<SentidoVale, Tom> = {
  DESCONTO: 'atencao',
  CREDITO: 'pago',
};

/** O que cada perfil pode fazer, em uma linha. */
export const PERFIL_LABEL: Record<PerfilUsuario, string> = {
  ADMIN: 'Administrador',
  RH: 'RH',
  VISUALIZADOR: 'Visualizador',
  TECNICO: 'Técnico de campo',
};

export const PERFIL_DESCRICAO: Record<PerfilUsuario, string> = {
  ADMIN: 'Faz tudo, inclusive criar e remover logins.',
  RH: 'Usa o app inteiro: folha, vales, contas a pagar. Não mexe em logins.',
  VISUALIZADOR: 'Só consulta. Não gera folha nem altera cadastro.',
  TECNICO:
    'Abre uma tela só: a análise de risco do serviço dele. Não enxerga folha, ' +
    'caixa nem documentos de ninguém.',
};

export const PERFIL_TOM: Record<PerfilUsuario, Tom> = {
  ADMIN: 'marca',
  RH: 'info',
  VISUALIZADOR: 'neutro',
  TECNICO: 'atencao',
};

// --- Análise de risco -------------------------------------------------------

export const STATUS_APR_LABEL: Record<StatusApr, string> = {
  RASCUNHO: 'Rascunho',
  LIBERADA: 'Liberada',
  CANCELADA: 'Cancelada',
};

export const STATUS_APR_TOM: Record<StatusApr, Tom> = {
  RASCUNHO: 'atencao',
  LIBERADA: 'pago',
  CANCELADA: 'neutro',
};

export const GRAVIDADE_LABEL: Record<GravidadeApr, string> = {
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
};

export const GRAVIDADE_TOM: Record<GravidadeApr, Tom> = {
  BAIXA: 'pago',
  MEDIA: 'atencao',
  ALTA: 'erro',
};

/** As respostas do relato, na ordem em que os botões aparecem. */
export const RESPOSTAS_RELATO: { valor: RespostaRelato; label: string }[] = [
  { valor: 'SIM', label: 'Sim' },
  { valor: 'NAO', label: 'Não' },
  { valor: 'NAO_SE_APLICA', label: 'N.A.' },
];

/**
 * O nome de cada bloco do formulário.
 *
 * É o titulo do bloco correspondente no formulário impresso, palavra por
 * palavra. Quem conhece o papel tem de reconhecer a tela sem precisar traduzir
 * nada — e é o mesmo texto que sai impresso de volta.
 */
export const CATEGORIA_APR_LABEL: Record<CategoriaItemApr, string> = {
  NORMA: 'Normas regulamentadoras envolvidas no processo',
  ATIVIDADE: 'Atividade a ser executada',
  RISCO: 'Riscos da atividade',
  FERRAMENTA: 'Máquinas, equipamentos e ferramentas utilizadas no processo',
  PROTECAO: 'Equipamentos de proteção individual e coletivos de uso obrigatório',
  RELATO: 'Relato situacional',
};
