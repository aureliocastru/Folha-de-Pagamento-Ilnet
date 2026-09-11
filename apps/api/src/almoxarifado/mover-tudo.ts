/**
 * O que um almoxarifado tem, separado em como cada coisa anda numa
 * transferência — sem cliente HTTP nenhum, para poder ser conferido.
 *
 * O caminho no IXC é a "Transferência entre Almoxarifados" da documentação:
 * `transf_almox_top` e, dentro dela, um `transf_almox_item` por coisa que vai
 * (ver `produtos-ixc.ts`). Duas espécies de item:
 *
 *  - **produto comum** — vai por quantidade ("2. Inserir produto na
 *    transferência");
 *  - **patrimônio** (ONU, roteador…) — vai peça por peça, cada uma com o seu
 *    registro em `patrimonio`, MAC e número ("3. Inserir patrimônio na
 *    transferência").
 */

import { numeroDoIxc } from './estoque.mapper';

/** Um produto com saldo no almoxarifado de origem. */
export interface ItemDoAlmoxarifado {
  produtoId: number;
  descricao: string;
  saldo: number;
  unidade: string | null;
}

/** Produto comum que pode ir — com o que o item da transferência pede. */
export interface ItemMovivel extends ItemDoAlmoxarifado {
  unidadeId: number;
  unidadeSigla: string;
  tipoProduto: string;
}

/** Fica — e o porquê, que a tela mostra. */
export interface ItemDeFora extends ItemDoAlmoxarifado {
  motivo: string;
}

/**
 * Saldo de patrimônio que não tem peça cadastrada no almoxarifado — o IXC tem
 * a quantidade, mas não o registro com MAC e número (ferramenta cadastrada
 * como patrimônio e que nunca ganhou peça, por exemplo). Pode ir pela
 * quantidade, se quem transfere pedir.
 */
export interface ItemSemPeca extends ItemMovivel {
  motivo: string;
}

/** Uma peça de patrimônio disponível no almoxarifado. */
export interface PatrimonioDoAlmoxarifado {
  patrimonioId: number;
  produtoId: number;
  descricao: string;
  /** `patrimonio.serial` — o "Número do patrimônio" da tela do IXC. */
  numeroPatrimonial: string | null;
  mac: string | null;
  /** `patrimonio.serial_fornecedor` — o número de série de fábrica. */
  numeroSerie: string | null;
  unidadeId: number;
  unidadeSigla: string;
}

/**
 * As situações de patrimônio que estão **na prateleira** do almoxarifado:
 * 1 Disponível e 7 Disponível Técnico. As outras (comodato, vendido,
 * inutilizado, alocado, indisponível — esta, a de quem já está numa
 * transferência) não estão ali para mover.
 */
const NO_ESTOQUE = new Set(['1', '7']);

/**
 * Situações de peça que ainda contam no saldo do almoxarifado sem estar na
 * prateleira: 6 Alocado e 8 Indisponível (presa numa transferência, OS ou
 * requisição). Havendo uma dessas, o saldo sem peça pode ser ela — e mover a
 * quantidade seria levar duas vezes a mesma coisa.
 */
const PRESA_AQUI = new Set(['6', '8']);

const NOME_DA_SITUACAO: Record<string, string> = {
  '3': 'vendida',
  '4': 'em comodato',
  '5': 'inutilizada',
  '6': 'alocada',
  '8': 'indisponível (presa em transferência, OS ou requisição)',
};

/**
 * As peças de cada produto que estão no almoxarifado mas **fora da
 * prateleira**, por situação — é o que explica um saldo de patrimônio sem
 * peça disponível: "1 indisponível", "2 em comodato".
 */
export function pecasForaDaPrateleira(
  linhas: Array<Record<string, unknown>>,
): Map<number, Map<string, number>> {
  const porProduto = new Map<number, Map<string, number>>();
  for (const l of linhas) {
    const situacao = String(l.situacao ?? '').trim();
    if (numeroDoIxc(l.id) <= 0 || NO_ESTOQUE.has(situacao)) continue;
    const produtoId = numeroDoIxc(l.id_produto);
    const contas = porProduto.get(produtoId) ?? new Map<string, number>();
    contas.set(situacao, (contas.get(situacao) ?? 0) + 1);
    porProduto.set(produtoId, contas);
  }
  return porProduto;
}

function descreverFora(contas: Map<string, number> | undefined): string {
  if (!contas) return '';
  return [...contas.entries()]
    .map(([s, n]) => `${n} ${NOME_DA_SITUACAO[s] ?? `na situação ${s}`}`)
    .join(', ');
}

function texto(v: unknown): string | null {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t === '' || t === '0' ? null : t;
}

/** "nº 00123 · MAC AA:BB:CC:DD:EE:FF · série ZTEG1234" — o que identifica a peça. */
export function identificacao(p: {
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
  patrimonioId: number;
}): string {
  const partes = [
    p.numeroPatrimonial && `nº ${p.numeroPatrimonial}`,
    p.mac && `MAC ${p.mac}`,
    p.numeroSerie && `série ${p.numeroSerie}`,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : `patrimônio #${p.patrimonioId}`;
}

/**
 * Os patrimônios do almoxarifado que podem ir: os que estão nele e na
 * prateleira, com produto e unidade no cadastro (o item da transferência pede
 * os dois).
 */
export function patrimoniosMoviveis(
  linhas: Array<Record<string, unknown>>,
  produtos: Map<number, Record<string, unknown>>,
  unidades: Array<{ id: number; sigla: string }>,
): { patrimonios: PatrimonioDoAlmoxarifado[]; deFora: ItemDeFora[] } {
  const patrimonios: PatrimonioDoAlmoxarifado[] = [];
  const deFora: ItemDeFora[] = [];

  for (const l of linhas) {
    const patrimonioId = numeroDoIxc(l.id);
    if (patrimonioId <= 0 || !NO_ESTOQUE.has(String(l.situacao ?? '').trim())) continue;
    const produtoId = numeroDoIxc(l.id_produto);
    const bruto = produtos.get(produtoId);
    const descricao =
      texto(bruto?.descricao) ?? texto(l.descricao) ?? `Produto ${produtoId || '?'}`;
    const peca = {
      patrimonioId,
      numeroPatrimonial: texto(l.serial) ?? texto(l.nro_patrimonio) ?? texto(l.cod_patrimonio),
      mac: texto(l.id_mac) ?? texto(l.mac),
      numeroSerie: texto(l.serial_fornecedor),
    };
    const fica = (motivo: string) =>
      deFora.push({
        produtoId,
        descricao: `${descricao} (${identificacao(peca)})`,
        saldo: 1,
        unidade: null,
        motivo,
      });

    if (!bruto) {
      fica('o cadastro do produto deste patrimônio não foi achado no IXC');
      continue;
    }
    const unidade = unidades.find((u) => u.id === numeroDoIxc(bruto.unidade));
    if (!unidade) {
      fica('o produto está sem unidade no cadastro — acerte na edição do produto');
      continue;
    }
    patrimonios.push({
      ...peca,
      produtoId,
      descricao,
      unidadeId: unidade.id,
      unidadeSigla: unidade.sigla,
    });
  }

  return {
    patrimonios: patrimonios.sort(
      (a, b) =>
        a.descricao.localeCompare(b.descricao, 'pt-BR') ||
        (a.numeroPatrimonial ?? '').localeCompare(b.numeroPatrimonial ?? '', 'pt-BR'),
    ),
    deFora,
  };
}

/**
 * Separa o saldo de produto em o que vai por quantidade e o que fica:
 *
 *  - saldo zero ou negativo não é "ter" nada — nem entra na conta;
 *  - produto de patrimônio não vai por quantidade: vai peça por peça, pelos
 *    registros de `patrimonio` (`porPatrimonio` diz quantas peças disponíveis
 *    foram achadas). Saldo sem peça que o explique é `semPeca` — pode ir pela
 *    quantidade, se pedirem —, a não ser que haja peça dele presa aqui
 *    (alocada, indisponível): aí o saldo pode ser ela, e fica;
 *  - serviço fica: não tem estoque;
 *  - produto sem unidade no cadastro fica: o item da transferência exige a
 *    unidade, e mandar uma inventada moveria a quantidade errada.
 */
export function separarMoviveis(
  itens: ItemDoAlmoxarifado[],
  produtos: Map<number, Record<string, unknown>>,
  unidades: Array<{ id: number; sigla: string }>,
  porPatrimonio: Map<number, number> = new Map(),
  foraDaPrateleira: Map<number, Map<string, number>> = new Map(),
): { moviveis: ItemMovivel[]; semPeca: ItemSemPeca[]; deFora: ItemDeFora[] } {
  const moviveis: ItemMovivel[] = [];
  const semPeca: ItemSemPeca[] = [];
  const deFora: ItemDeFora[] = [];

  for (const item of itens) {
    if (!(item.saldo > 0)) continue;
    const bruto = produtos.get(item.produtoId);
    if (!bruto) {
      deFora.push({ ...item, motivo: 'o cadastro do produto não foi achado no IXC' });
      continue;
    }
    const tipo = String(bruto.tipo ?? '').trim().toUpperCase();
    if (tipo === 'S') {
      deFora.push({ ...item, motivo: 'serviço não tem estoque' });
      continue;
    }
    const unidade = unidades.find((u) => u.id === numeroDoIxc(bruto.unidade));
    if (tipo === 'P') {
      const sobra = Math.round((item.saldo - (porPatrimonio.get(item.produtoId) ?? 0)) * 1000) / 1000;
      if (!(sobra > 0)) continue;
      const fora = foraDaPrateleira.get(item.produtoId);
      const presa = [...(fora?.keys() ?? [])].some((s) => PRESA_AQUI.has(s));
      if (presa || !unidade) {
        deFora.push({
          ...item,
          saldo: sobra,
          motivo: presa
            ? `patrimônio: o saldo pode ser a peça que está aqui ${descreverFora(fora)} — ` +
              'resolva a peça no IXC antes'
            : 'patrimônio sem peça e sem unidade no cadastro — acerte na edição do produto',
        });
        continue;
      }
      const onde = descreverFora(fora);
      semPeca.push({
        ...item,
        saldo: sobra,
        unidadeId: unidade.id,
        unidadeSigla: unidade.sigla,
        tipoProduto: 'P',
        motivo:
          'patrimônio sem peça cadastrada aqui (sem MAC nem número)' +
          (onde ? ` — das peças dele, ${onde}` : ''),
      });
      continue;
    }
    if (!unidade) {
      deFora.push({ ...item, motivo: 'sem unidade no cadastro — acerte na edição do produto' });
      continue;
    }
    moviveis.push({
      ...item,
      unidadeId: unidade.id,
      unidadeSigla: unidade.sigla,
      tipoProduto: String(bruto.tipo ?? ''),
    });
  }

  const porNome = (a: ItemDoAlmoxarifado, b: ItemDoAlmoxarifado) =>
    a.descricao.localeCompare(b.descricao, 'pt-BR');
  return {
    moviveis: moviveis.sort(porNome),
    semPeca: semPeca.sort(porNome),
    deFora: deFora.sort(porNome),
  };
}

/**
 * Faz `tarefa` para cada item, no máximo `quantas` ao mesmo tempo. O IXC
 * aguenta algumas inserções em paralelo; centenas de uma vez, não — e uma a
 * uma, um almoxarifado grande levaria minutos.
 */
export async function emParalelo<T>(
  itens: T[],
  quantas: number,
  tarefa: (item: T) => Promise<void>,
): Promise<void> {
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const item = itens[proximo];
      proximo += 1;
      await tarefa(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(quantas, itens.length) }, trabalhador));
}
