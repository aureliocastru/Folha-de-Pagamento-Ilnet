import {
  IconeCaixa,
  IconeCalculo,
  IconeCalendarioVolta,
  IconeChave,
  IconeDia,
  IconeDocumento,
  IconeEngrenagem,
  IconeEtiqueta,
  IconeGuia,
  IconeMartelo,
  IconeMoeda,
  IconePainel,
  IconePasta,
  IconePessoas,
  IconePredio,
  IconeRecibo,
  IconeSaida,
  IconeSol,
  IconeTransferencia,
  type Icone,
} from '../components/icones';
import type { PerfilUsuario } from './types';

/**
 * O caminho é relativo à base do módulo: dentro de uma rota aninhada o
 * NavLink resolve `dashboard` como `/folha/dashboard` sozinho. Assim a base
 * aparece uma vez só, no módulo.
 */
export interface ItemMenu {
  to: string;
  label: string;
  icone: Icone;
  somenteAdmin?: boolean;
}

export interface Modulo {
  id: string;
  nome: string;
  /** O que o cartão promete de dentro do módulo. */
  descricao: string;
  base: string;
  /** Para onde o cartão leva — o caminho relativo da primeira tela. */
  inicio: string;
  icone: Icone;
  /** Cor do quadrado do ícone no cartão: cada módulo tem a sua. */
  tom: string;
  /**
   * Quem enxerga o módulo. Vazio = todo mundo que está logado.
   *
   * Não é a proteção — quem recusa de verdade é a API, que exige o perfil em
   * cada rota. Aqui o módulo some da tela para ninguém entrar num lugar onde
   * cada clique vai devolver "seu perfil não tem acesso".
   */
  papeis?: PerfilUsuario[];
  menu: ItemMenu[];
}

const folha: Modulo = {
  id: 'folha',
  nome: 'Folha de Pagamento',
  descricao:
    'Funcionários, diaristas, vales, férias, impostos e a folha do mês',
  base: '/folha',
  inicio: 'dashboard',
  icone: IconePessoas,
  tom: 'bg-brand-500/15 text-brand-300',
  menu: [
    { to: 'dashboard', label: 'Dashboard', icone: IconePainel },
    { to: 'funcionarios', label: 'Funcionários', icone: IconePessoas },
    { to: 'diaristas', label: 'Diaristas', icone: IconeDia },
    { to: 'vales', label: 'Vales e Acertos', icone: IconeMoeda },
    { to: 'ferias', label: 'Férias', icone: IconeSol },
    { to: 'gerar-folha', label: 'Gerar Folha', icone: IconeCalculo },
    { to: 'pagamentos', label: 'Pagamentos da Folha', icone: IconeSaida },
    { to: 'avulsos', label: 'Pagamentos Avulsos', icone: IconeRecibo },
    { to: 'impostos', label: 'Impostos', icone: IconeGuia },
    { to: 'configuracoes', label: 'Configurações', icone: IconeEngrenagem },
    {
      to: 'usuarios',
      label: 'Usuários',
      icone: IconeChave,
      somenteAdmin: true,
    },
  ],
};

const contasPagar: Modulo = {
  id: 'contas-pagar',
  nome: 'Contas a Pagar',
  descricao:
    'O que a empresa deve e o que já pagou, direto do IXC: vencidas, a vencer e o histórico',
  base: '/contas-pagar',
  inicio: 'inicio',
  icone: IconeSaida,
  tom: 'bg-emerald-500/15 text-emerald-300',
  menu: [
    { to: 'inicio', label: 'Em aberto', icone: IconeSaida },
    // As duas metades da mesma tabela do IXC, uma ao lado da outra: o que a
    // empresa deve e o que ela já pagou.
    { to: 'pagos', label: 'Já pagos', icone: IconeMoeda },
    { to: 'dashboard', label: 'Dashboard', icone: IconePainel },
    // Avulsos vive nos dois módulos, com os mesmos dados: é pagamento da
    // empresa (daqui) e é lançamento que a folha usa (de lá). Duplicar o
    // caminho custa menos que obrigar a trocar de módulo no meio do trabalho.
    { to: 'avulsos', label: 'Pagamentos Avulsos', icone: IconeRecibo },
    { to: 'recorrentes', label: 'Recorrentes', icone: IconeCalendarioVolta },
    // A conta de luz de cada endereço. Fica ao lado das recorrentes porque é
    // a mesma pergunta — o que se paga todo mês —, e separada porque o valor
    // desta só se sabe quando a fatura chega.
    { to: 'contas-contrato', label: 'Contas Contrato', icone: IconePredio },
    { to: 'categorias', label: 'Categorias', icone: IconeEtiqueta },
    // Bater o caixa do dinheiro em mãos: conferir as saídas do período,
    // fotografar a nota e declarar o que ainda está na rua com alguém.
    { to: 'fechamento-caixa', label: 'Fechamento de Caixa', icone: IconeCaixa },
    // Dinheiro que muda de conta, no IXC junto. Só ADMIN, e ainda pede a senha
    // ao abrir: é a única tela daqui que move saldo entre contas sem haver
    // nota nenhuma para conferir depois.
    {
      to: 'transferencias',
      label: 'Transferência entre Contas',
      icone: IconeTransferencia,
      somenteAdmin: true,
    },
  ],
};

/**
 * RH — a estante de documentos da casa.
 *
 * Contrato, exame, advertência, o recibo de pagamento de cada mês. Só ADMIN e
 * RH: é o único módulo em que a leitura já é assunto de perfil, porque o que
 * está guardado aqui é a vida funcional das pessoas.
 */
const rh: Modulo = {
  id: 'rh',
  nome: 'RH',
  descricao:
    'A estante de documentos: a pasta de cada funcionário e a da empresa',
  base: '/rh',
  inicio: 'pastas',
  icone: IconePasta,
  tom: 'bg-amber-500/15 text-amber-300',
  papeis: ['ADMIN', 'RH'],
  menu: [
    { to: 'pastas', label: 'Pastas', icone: IconePasta },
    /*
     * A pasta da empresa tem porta própria.
     *
     * A estante lista gente — quarenta e poucas pastas em ordem alfabética —, e
     * a da empresa é a única que não é de ninguém e a única em que se entra
     * várias vezes por semana: contrato social, alvará, as certidões que a
     * licitação pede. Achá-la caçando "Empresa" no meio dos nomes é o caminho
     * mais longo para o lugar mais visitado.
     */
    { to: 'empresa', label: 'Empresa', icone: IconePredio },
    { to: 'recibos', label: 'Recibos da folha', icone: IconeDocumento },
    /*
     * A pasta que se monta para entregar.
     *
     * Ela sai da pasta da empresa e volta para lá — as mesmas certidões —, mas
     * a pergunta é outra: não é "o que a empresa tem?", é "o que foi entregue
     * naquele pregão?". A segunda só tem resposta se houver um lugar em que a
     * cópia do dia fica guardada, e é este.
     */
    { to: 'licitacoes', label: 'Licitações', icone: IconeMartelo },
  ],
};

/** A ordem daqui é a ordem dos cartões na tela de módulos. */
export const MODULOS: Modulo[] = [folha, contasPagar, rh];

export const MODULO_FOLHA = folha;
export const MODULO_CONTAS_PAGAR = contasPagar;
export const MODULO_RH = rh;

/**
 * Os módulos que este login abre.
 *
 * Duas perguntas se somam aqui. O **perfil** diz o que a pessoa pode fazer, e
 * alguns módulos só existem para certos perfis (o RH guarda contrato e exame
 * médico). A **lista do login** diz onde ela trabalha, e é o administrador quem
 * a distribui — quem cuida do RH não tem o que fazer no caixa da empresa.
 *
 * Lista vazia é sem restrição, e ADMIN passa sempre: é ele quem distribui o
 * acesso, e trancar a si mesmo não teria conserto pela tela. A API repete a
 * mesma conta — aqui o módulo só some do menu.
 */
export function modulosDoUsuario(usuario?: {
  role: PerfilUsuario;
  modulos?: string[];
} | null): Modulo[] {
  if (!usuario) return [];
  const lista = usuario.modulos ?? [];
  const semRestricao = usuario.role === 'ADMIN' || lista.length === 0;

  return MODULOS.filter((m) => {
    if (m.papeis && !m.papeis.includes(usuario.role)) return false;
    return semRestricao || lista.includes(m.id);
  });
}

export function caminhoInicial(modulo: Modulo): string {
  return `${modulo.base}/${modulo.inicio}`;
}
