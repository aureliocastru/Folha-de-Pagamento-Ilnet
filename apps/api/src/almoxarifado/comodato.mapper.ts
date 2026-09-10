/**
 * O comodato do IXC, arrumado para a tela: o que está emprestado a cliente, e
 * com quem.
 *
 * Três tabelas de lá se juntam aqui, pelos números que uma guarda da outra:
 *
 *  - `cliente_contrato_comodato` — a peça que saiu ("Comodato - Produto
 *    (listar)", filtrada por `status_comodato = "E"`, emprestado): produto,
 *    quantidade, número de série, MAC, de que almoxarifado saiu e para que
 *    contrato;
 *  - `cliente_contrato` — o contrato: o cliente dele e o endereço de
 *    instalação, que é onde a peça está de fato;
 *  - `cliente` — o nome de quem está com ela.
 */

import { numeroDoIxc } from './estoque.mapper';

/** Uma linha crua do comodato (é uma linha de `movimento_produtos`). */
export interface LinhaDeComodatoIxc {
  id?: string;
  id_produto?: string;
  id_contrato?: string;
  id_almox?: string;
  qtde_saida?: string;
  numero_serie?: string;
  mac?: string;
  numero_patrimonial?: string;
  descricao?: string;
  data?: string;
  status_comodato?: string;
}

export interface ContratoIxc {
  id?: string;
  id_cliente?: string;
  contrato?: string;
  status?: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;
}

export interface ClienteIxc {
  id?: string;
  razao?: string;
  fantasia?: string;
}

/** Uma peça emprestada, e onde ela está. */
export interface ItemEmComodato {
  id: number;
  produtoId: number;
  produto: string;
  quantidade: number;
  numeroSerie: string | null;
  mac: string | null;
  patrimonio: string | null;
  /** Quando saiu, "AAAA-MM-DD". */
  desde: string | null;
  /** De qual almoxarifado a peça saiu. */
  almoxarifado: string | null;
  contratoId: number;
  /** O plano do contrato. */
  plano: string | null;
  /** A, I, D, N, P — a situação do contrato no IXC. */
  contratoStatus: string | null;
  clienteId: number | null;
  cliente: string;
  /** O endereço de instalação do contrato: onde a peça está. */
  endereco: string | null;
}

/** "rua x, 12 — bairro" a partir dos pedaços do contrato. */
function enderecoDo(c: ContratoIxc | undefined): string | null {
  if (!c) return null;
  const rua = [c.endereco, c.numero].map((p) => (p ?? '').trim()).filter(Boolean).join(', ');
  const partes = [rua, (c.complemento ?? '').trim(), (c.bairro ?? '').trim()].filter(Boolean);
  return partes.length ? partes.join(' — ') : null;
}

function textoOuNulo(v: unknown): string | null {
  const t = String(v ?? '').trim();
  return t && t !== '0' ? t : null;
}

export function montarComodatos(
  linhas: LinhaDeComodatoIxc[],
  contratos: Map<number, ContratoIxc>,
  clientes: Map<number, ClienteIxc>,
  produtos: Map<number, string>,
  almoxarifados: Map<number, string>,
): ItemEmComodato[] {
  const itens: ItemEmComodato[] = [];
  for (const l of linhas) {
    // O filtro vai ao IXC, mas a conferência fica aqui também: peça devolvida
    // na lista de "está com o cliente" é o engano mais caro desta tela.
    if ((l.status_comodato ?? 'E').toUpperCase() !== 'E') continue;
    const produtoId = numeroDoIxc(l.id_produto);
    const contratoId = numeroDoIxc(l.id_contrato);
    if (produtoId === 0 || contratoId === 0) continue;

    const contrato = contratos.get(contratoId);
    const clienteId = contrato ? numeroDoIxc(contrato.id_cliente) || null : null;
    const cliente = clienteId ? clientes.get(clienteId) : undefined;

    itens.push({
      id: numeroDoIxc(l.id),
      produtoId,
      produto:
        produtos.get(produtoId) ?? textoOuNulo(l.descricao) ?? `Produto ${produtoId}`,
      quantidade: numeroDoIxc(l.qtde_saida) || 1,
      numeroSerie: textoOuNulo(l.numero_serie),
      mac: textoOuNulo(l.mac),
      patrimonio: textoOuNulo(l.numero_patrimonial),
      desde: textoOuNulo(l.data)?.slice(0, 10) ?? null,
      almoxarifado: almoxarifados.get(numeroDoIxc(l.id_almox)) ?? null,
      contratoId,
      plano: textoOuNulo(contrato?.contrato),
      contratoStatus: textoOuNulo(contrato?.status),
      clienteId,
      cliente:
        textoOuNulo(cliente?.razao) ??
        textoOuNulo(cliente?.fantasia) ??
        (clienteId ? `Cliente ${clienteId}` : `Contrato ${contratoId}`),
      endereco: enderecoDo(contrato),
    });
  }
  return itens.sort(
    (a, b) =>
      a.produto.localeCompare(b.produto, 'pt-BR') ||
      a.cliente.localeCompare(b.cliente, 'pt-BR'),
  );
}

/** Por produto: quantas peças estão fora, e com quantos contratos. */
export function resumirComodatos(itens: ItemEmComodato[]): Array<{
  produtoId: number;
  produto: string;
  quantidade: number;
  contratos: number;
}> {
  const porProduto = new Map<number, { produto: string; quantidade: number; contratos: Set<number> }>();
  for (const i of itens) {
    const p = porProduto.get(i.produtoId) ?? {
      produto: i.produto,
      quantidade: 0,
      contratos: new Set<number>(),
    };
    p.quantidade += i.quantidade;
    p.contratos.add(i.contratoId);
    porProduto.set(i.produtoId, p);
  }
  return [...porProduto.entries()]
    .map(([produtoId, p]) => ({
      produtoId,
      produto: p.produto,
      quantidade: Math.round(p.quantidade * 1000) / 1000,
      contratos: p.contratos.size,
    }))
    .sort((a, b) => b.quantidade - a.quantidade || a.produto.localeCompare(b.produto, 'pt-BR'));
}
