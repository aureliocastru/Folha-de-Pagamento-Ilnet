/**
 * A nota fiscal de compra do almoxarifado, como a API a devolve, e as contas
 * que as duas telas dela fazem (a de lançar, no Almoxarifado, e a de
 * confirmar, no Contas a Pagar).
 */

export interface ItemDaNota {
  produtoId: number;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  /** O IXC aceitou este produto na compra. */
  entrou: boolean;
  motivo: string | null;
}

export interface ParcelaDaNota {
  /** "AAAA-MM-DD" */
  vencimento: string;
  valor: number;
  /** O título no IXC, quando a parcela já virou conta. */
  idFnApagar?: number | null;
}

export interface NotaDeCompra {
  id: string;
  numeroNota: string;
  fornecedor: { id: number; nome: string };
  dataEmissao: string;
  almoxarifado: string;
  valorTotal: number;
  /** A compra no IXC (Entradas › Compras). */
  entradaId: number;
  /** Null = a compra foi fechada no IXC; o texto diz por que ficou aberta. */
  compraAberta: string | null;
  itens: ItemDaNota[];
  parcelas: ParcelaDaNota[];
  situacao: 'AGUARDANDO' | 'CONFIRMADA' | 'RECUSADA' | 'SEM_CONTA';
  lancadaPor: string;
  lancadaEm: string;
  decididaPor: string | null;
  motivoDaRecusa: string | null;
}

/** Hoje, "AAAA-MM-DD", no fuso de quem está na tela. */
export function hojeIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}

/** O mesmo dia, `meses` à frente; dia 31 num mês de 30 vira o último dele. */
export function somarMeses(iso: string, meses: number): string {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const alvo = new Date(ano, mes - 1 + meses, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  const m = String(alvo.getMonth() + 1).padStart(2, '0');
  return `${alvo.getFullYear()}-${m}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

/**
 * O total dividido em parcelas mensais iguais; os centavos que sobram da
 * divisão vão na última, para a soma fechar com a nota.
 */
export function dividirEmParcelas(
  total: number,
  quantas: number,
  primeiroVencimento: string,
): Array<{ vencimento: string; valor: string }> {
  if (quantas <= 0 || !(total > 0) || !primeiroVencimento) return [];
  const centavos = Math.round(total * 100);
  const cada = Math.floor(centavos / quantas);
  return Array.from({ length: quantas }, (_, i) => ({
    vencimento: somarMeses(primeiroVencimento, i),
    valor: ((i === quantas - 1 ? centavos - cada * (quantas - 1) : cada) / 100).toFixed(2),
  }));
}

/** "10,5" ou "10.5" → 10.5; o que não é número vira NaN. */
export function lerQuantidade(texto: string): number {
  const cru = texto.trim();
  // Com vírgula, o ponto é de milhar ("1.250,5"); sem ela, é o decimal.
  const limpo = cru.includes(',') ? cru.replace(/\./g, '').replace(',', '.') : cru;
  return limpo === '' ? NaN : Number(limpo);
}
