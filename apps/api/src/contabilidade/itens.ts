/**
 * Os vinte itens do papel da contabilidade, na numeração dele.
 *
 * A numeração é a do documento que eles mandaram ("01. Extratos bancários",
 * "02. Extratos de aplicações financeiras"…), e é ela que nomeia as pastas do
 * zip: quem abre do outro lado procura pelo número que ele mesmo escreveu.
 */

/** De onde o item sai. */
export type Origem =
  /** Lido do IXC, sem nada a fazer além de conferir. */
  | 'ixc'
  /** Montado do que este sistema já guarda (fechamento de caixa, vales). */
  | 'sistema'
  /** Só existe fora: alguém baixa no site do banco e põe aqui. */
  | 'arquivo'
  /** As duas coisas: a lista sai do IXC, o papel de cada linha vem de fora. */
  | 'misto';

export interface ItemDoPapel {
  numero: number;
  titulo: string;
  /** O que o papel pede, em uma linha. */
  pedido: string;
  origem: Origem;
  /**
   * Pode não ter acontecido no mês — aplicação, empréstimo, doação. Para
   * esses, "não teve" é resposta e o item fica pronto.
   */
  podeNaoTer: boolean;
}

export const ITENS: readonly ItemDoPapel[] = [
  {
    numero: 1,
    titulo: 'Extratos bancários',
    pedido: 'PDF, Excel e OFX de cada conta do banco',
    origem: 'arquivo',
    podeNaoTer: false,
  },
  {
    numero: 2,
    titulo: 'Extratos de aplicações financeiras',
    pedido: 'Valores investidos, rendimentos, resgates e impostos retidos',
    origem: 'arquivo',
    podeNaoTer: true,
  },
  {
    numero: 3,
    titulo: 'Contratos de empréstimos e financiamentos',
    pedido: 'Os contratos em vigor: valores, juros, prazos',
    origem: 'arquivo',
    podeNaoTer: true,
  },
  {
    numero: 4,
    titulo: 'Extratos de operações de crédito',
    pedido: 'Valores usados, pagamentos, juros e saldos',
    origem: 'arquivo',
    podeNaoTer: true,
  },
  {
    numero: 5,
    titulo: 'Saldo de estoque',
    pedido: 'O que estava em estoque no último dia, com o valor',
    origem: 'ixc',
    podeNaoTer: false,
  },
  {
    numero: 6,
    titulo: 'Saldo de clientes',
    pedido: 'O que os clientes ainda deviam no último dia',
    origem: 'ixc',
    podeNaoTer: false,
  },
  {
    numero: 7,
    titulo: 'Faturamento real',
    pedido: 'Os serviços e vendas do período, as notas e o recebido',
    origem: 'ixc',
    podeNaoTer: false,
  },
  {
    numero: 8,
    titulo: 'Documentação das saídas bancárias e do caixa',
    pedido: 'Nota, recibo ou comprovante de cada pagamento',
    origem: 'misto',
    podeNaoTer: false,
  },
  {
    numero: 9,
    titulo: 'Conciliação bancária',
    pedido: 'O extrato do banco comparado com o IXC',
    origem: 'misto',
    podeNaoTer: false,
  },
  {
    numero: 10,
    titulo: 'Conciliação do caixa físico',
    pedido: 'Entradas e saídas do caixa conferidas com o dinheiro',
    origem: 'sistema',
    podeNaoTer: false,
  },
  {
    numero: 11,
    titulo: 'Saldo do caixa físico',
    pedido: 'O dinheiro no caixa no último dia',
    origem: 'sistema',
    podeNaoTer: false,
  },
  {
    numero: 12,
    titulo: 'Saldo de fornecedores',
    pedido: 'O que a empresa ainda devia no último dia',
    origem: 'ixc',
    podeNaoTer: false,
  },
  {
    numero: 13,
    titulo: 'Distribuição de lucros',
    pedido: 'O que foi pago aos sócios como lucro',
    origem: 'ixc',
    podeNaoTer: true,
  },
  {
    numero: 14,
    titulo: 'Nota fiscal de compra de link',
    pedido: 'A nota de cada link de internet comprado',
    origem: 'misto',
    podeNaoTer: true,
  },
  {
    numero: 15,
    titulo: 'Fatura de cartão de crédito e notas fiscais',
    pedido: 'A fatura do cartão, as compras dela e as notas',
    origem: 'misto',
    podeNaoTer: true,
  },
  {
    numero: 16,
    titulo: 'Relatório de vendas por cartão',
    pedido: 'O que entrou por maquininha, com as taxas',
    origem: 'misto',
    podeNaoTer: true,
  },
  {
    numero: 17,
    titulo: 'Relatório de vales a funcionários',
    pedido: 'Adiantamentos pagos pelo banco ou pelo caixa',
    origem: 'sistema',
    podeNaoTer: true,
  },
  {
    numero: 18,
    titulo: 'Relatório de doações',
    pedido: 'Quem recebeu, quanto, e o comprovante',
    origem: 'ixc',
    podeNaoTer: true,
  },
  {
    numero: 19,
    titulo: 'Relatório de juros a receber',
    pedido: 'Juros e multa cobrados de clientes que pagaram atrasado',
    origem: 'ixc',
    podeNaoTer: true,
  },
  {
    numero: 20,
    titulo: 'Relatório de descontos obtidos',
    pedido: 'Descontos recebidos ao pagar fornecedores',
    origem: 'ixc',
    podeNaoTer: true,
  },
];

export function itemDoPapel(numero: number): ItemDoPapel {
  const item = ITENS.find((i) => i.numero === numero);
  if (!item) throw new Error(`O papel da contabilidade não tem item ${numero}.`);
  return item;
}

/** "08 - Documentação das saídas bancárias e do caixa": a pasta no zip. */
export function pastaDoItem(numero: number): string {
  return `${String(numero).padStart(2, '0')} - ${itemDoPapel(numero).titulo}`;
}
