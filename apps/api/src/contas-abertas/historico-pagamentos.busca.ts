import type { PagamentoFeito } from './historico-pagamentos.mapper';

/**
 * A busca dos pagamentos feitos no histórico inteiro, sem período.
 *
 * Na tela, a busca peneira o que o período trouxe. Mas quem procura um
 * pagamento quase nunca sabe o mês dele — procura pelo fornecedor, pelo número
 * do documento, pelo valor. Então, com texto digitado, o período sai da frente
 * e a pergunta vai ao IXC: os títulos baixados que têm o termo, de qualquer
 * ano.
 *
 * As regras de comparação são as da tela (`apps/web/src/lib/busca.ts`), e não
 * outras: sem acento, sem caixa, e o código também sem separador. Se o servidor
 * achasse com uma regra e a tela peneirasse com outra, o pagamento achado
 * sumiria na frente de quem procurou.
 */

/** Menos que isto acha meia base e não diz nada. */
export const MINIMO_DA_BUSCA = 2;

/** Quantos pagamentos a busca devolve, dos mais recentes para trás. */
export const LIMITE_DA_BUSCA = 200;

/** Texto como a busca o vê: sem acento e sem caixa. */
export function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** O código como se digita: sem acento, sem caixa e sem separador. */
function semSeparador(texto: string): string {
  return semAcento(texto).replace(/[^\p{L}\p{N}]/gu, '');
}

type Campo = string | number | null | undefined;

/**
 * Algum destes campos contém o termo? O mesmo `combina` da tela: o termo
 * inteiro dentro de um campo, ou — sendo uma palavra só — o termo sem
 * separador dentro do campo sem separador ("2330" acha "R$ 2.330,00").
 */
export function casaComABusca(campos: Campo[], digitado: string): boolean {
  const termo = semAcento(digitado.trim());
  if (!termo) return true;
  const colado = /\s/.test(termo) ? '' : semSeparador(termo);
  const cheios = campos.filter((c) => c !== null && c !== undefined && c !== '').map(String);
  return cheios.some(
    (c) => semAcento(c).includes(termo) || (!!colado && semSeparador(c).includes(colado)),
  );
}

/** O que a tela procura em cada pagamento — a mesma lista do `filtrar` de lá. */
export function camposDaBusca(p: PagamentoFeito): Campo[] {
  return [
    p.fornecedor.nome,
    p.documento,
    p.observacao,
    p.formaPagamento,
    p.caixa.nome,
    p.classificacao?.nome,
    p.origem?.beneficiario,
    brl(p.valorPago),
    brl(p.valor),
  ];
}

/**
 * O termo é um valor em reais? "2330", "2.330,00", "2330,5" e "R$ 2.330,00"
 * são; "38255A" e "12/10" não. Um número também pode ser documento — por isso
 * quem chama procura das duas formas.
 */
export function valorDaBusca(digitado: string): number | null {
  const t = digitado.replace(/^r\$\s*/i, '').trim();
  let normal: string | null = null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+(,\d{1,2})?$/.test(t)) normal = t.replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(t)) normal = t;
  if (normal === null) return null;
  const valor = Number(normal);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

/** Os códigos cujo nome contém o termo — fornecedores, contas. */
export function idsQueCasam(nomes: Map<number, string>, digitado: string): number[] {
  const ids: number[] = [];
  for (const [id, nome] of nomes) {
    if (casaComABusca([nome], digitado)) ids.push(id);
  }
  return ids;
}

/**
 * As formas do termo que vão ao IXC: como foi digitado e sem acento. A
 * comparação do IXC é a do banco dele, e não dá para saber daqui se ela ignora
 * acento — mandando as duas, "manutencao" e "manutenção" acham o mesmo.
 */
export function variantesDoTermo(digitado: string): string[] {
  const texto = digitado.trim().replace(/\s+/g, ' ');
  const sem = texto.normalize('NFD').replace(/\p{M}/gu, '');
  return sem === texto ? [texto] : [texto, sem];
}

function brl(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
