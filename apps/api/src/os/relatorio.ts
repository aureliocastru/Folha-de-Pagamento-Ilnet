/**
 * O relatório do mês das ordens de serviço — a conta, sem banco, para poder
 * ser provada.
 *
 * Três perguntas que a base faz no fim do mês:
 *
 *  - **quanto cada técnico gastou**, em quantidade e em dinheiro, e em quantas
 *    OS — é o número que se compara entre eles;
 *  - **quanto saiu de cada material**, e a média por OS: o conector que passa
 *    de dois por OS é o que se vai perguntar;
 *  - **o que entrou e saiu de aparelho**, e quantos voltaram com defeito.
 *
 * Entra só o que está **gravado no IXC**, pelo dia em que foi gravado: o
 * relatório é do que de fato saiu do estoque, e não do que alguém anotou e
 * ficou para trás.
 */

export interface ItemParaRelatorio {
  tipo: 'INSTALADO' | 'RETIRADO' | 'MATERIAL' | 'DIVERGENCIA';
  tecnicoId: string;
  tecnico: string;
  osIxcId: number;
  produtoId: number | null;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  valorUnitario: number | null;
  condicao: 'FUNCIONANDO' | 'DEFEITO' | 'NAO_TESTADO' | null;
  observacao: string | null;
}

export interface MaterialNoRelatorio {
  produtoId: number;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  valor: number;
  /** Em quantas OS apareceu. */
  os: number;
  mediaPorOs: number;
}

export interface TecnicoNoRelatorio {
  tecnicoId: string;
  tecnico: string;
  os: number;
  instalados: number;
  retirados: number;
  comDefeito: number;
  divergencias: number;
  valorMateriais: number;
  materiais: MaterialNoRelatorio[];
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
  porTecnico: TecnicoNoRelatorio[];
  materiais: Array<MaterialNoRelatorio & { porTecnico: Array<{ tecnico: string; quantidade: number }> }>;
  aparelhos: Array<{
    produtoId: number | null;
    descricao: string;
    instalados: number;
    retirados: number;
    comDefeito: number;
  }>;
  /** O material acima do normal, com o porquê que o técnico escreveu. */
  justificativas: Array<{
    osIxcId: number;
    tecnico: string;
    descricao: string;
    quantidade: number;
    unidade: string | null;
    observacao: string;
  }>;
}

export function montarRelatorio(competencia: string, itens: ItemParaRelatorio[]): RelatorioDoMes {
  const materiais = itens.filter((i) => i.tipo === 'MATERIAL' && i.produtoId);

  const porTecnico = new Map<string, ItemParaRelatorio[]>();
  for (const i of itens) porTecnico.set(i.tecnicoId, [...(porTecnico.get(i.tecnicoId) ?? []), i]);

  const tecnicos: TecnicoNoRelatorio[] = [...porTecnico.entries()]
    .map(([tecnicoId, dele]) => {
      const gastos = somarMateriais(dele.filter((i) => i.tipo === 'MATERIAL' && i.produtoId));
      return {
        tecnicoId,
        tecnico: dele[0].tecnico,
        os: new Set(dele.map((i) => i.osIxcId)).size,
        instalados: contar(dele, 'INSTALADO'),
        retirados: contar(dele, 'RETIRADO'),
        comDefeito: dele.filter((i) => i.tipo === 'RETIRADO' && i.condicao === 'DEFEITO').length,
        divergencias: contar(dele, 'DIVERGENCIA'),
        valorMateriais: dinheiro(gastos.reduce((s, m) => s + m.valor, 0)),
        materiais: gastos,
      };
    })
    .sort((a, b) => b.valorMateriais - a.valorMateriais || a.tecnico.localeCompare(b.tecnico, 'pt-BR'));

  const aparelhos = new Map<string, RelatorioDoMes['aparelhos'][number]>();
  for (const i of itens.filter((x) => x.tipo === 'INSTALADO' || x.tipo === 'RETIRADO')) {
    const chave = i.produtoId ? String(i.produtoId) : i.descricao;
    const a = aparelhos.get(chave) ?? {
      produtoId: i.produtoId,
      descricao: i.descricao,
      instalados: 0,
      retirados: 0,
      comDefeito: 0,
    };
    if (i.tipo === 'INSTALADO') a.instalados += 1;
    else {
      a.retirados += 1;
      if (i.condicao === 'DEFEITO') a.comDefeito += 1;
    }
    aparelhos.set(chave, a);
  }

  const valorMateriais = dinheiro(materiais.reduce((s, i) => s + valorDe(i), 0));
  return {
    competencia,
    totais: {
      os: new Set(itens.map((i) => i.osIxcId)).size,
      instalados: contar(itens, 'INSTALADO'),
      retirados: contar(itens, 'RETIRADO'),
      comDefeito: itens.filter((i) => i.tipo === 'RETIRADO' && i.condicao === 'DEFEITO').length,
      divergencias: contar(itens, 'DIVERGENCIA'),
      valorMateriais,
    },
    porTecnico: tecnicos,
    materiais: somarMateriais(materiais).map((m) => {
      const dele = new Map<string, number>();
      for (const i of materiais.filter((x) => x.produtoId === m.produtoId)) {
        dele.set(i.tecnico, qtde((dele.get(i.tecnico) ?? 0) + i.quantidade));
      }
      return {
        ...m,
        porTecnico: [...dele.entries()]
          .map(([tecnico, quantidade]) => ({ tecnico, quantidade }))
          .sort((a, b) => b.quantidade - a.quantidade),
      };
    }),
    aparelhos: [...aparelhos.values()].sort(
      (a, b) => b.instalados + b.retirados - (a.instalados + a.retirados),
    ),
    justificativas: materiais
      .filter((i) => (i.observacao ?? '').trim())
      .map((i) => ({
        osIxcId: i.osIxcId,
        tecnico: i.tecnico,
        descricao: i.descricao,
        quantidade: i.quantidade,
        unidade: i.unidade,
        observacao: (i.observacao ?? '').trim(),
      }))
      .sort((a, b) => a.osIxcId - b.osIxcId),
  };
}

/** Por produto: quanto, quanto custou, em quantas OS, e a média por OS. */
function somarMateriais(itens: ItemParaRelatorio[]): MaterialNoRelatorio[] {
  const porProduto = new Map<number, { base: ItemParaRelatorio; quantidade: number; valor: number; os: Set<number> }>();
  for (const i of itens) {
    const id = i.produtoId as number;
    const p = porProduto.get(id) ?? { base: i, quantidade: 0, valor: 0, os: new Set<number>() };
    p.quantidade += i.quantidade;
    p.valor += valorDe(i);
    p.os.add(i.osIxcId);
    porProduto.set(id, p);
  }
  return [...porProduto.entries()]
    .map(([produtoId, p]) => ({
      produtoId,
      descricao: p.base.descricao,
      unidade: p.base.unidade,
      quantidade: qtde(p.quantidade),
      valor: dinheiro(p.valor),
      os: p.os.size,
      mediaPorOs: qtde(p.quantidade / Math.max(1, p.os.size)),
    }))
    .sort((a, b) => b.valor - a.valor || a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

function valorDe(i: ItemParaRelatorio): number {
  return (i.valorUnitario ?? 0) * i.quantidade;
}

function contar(itens: ItemParaRelatorio[], tipo: ItemParaRelatorio['tipo']): number {
  return itens.filter((i) => i.tipo === tipo).length;
}

function dinheiro(n: number): number {
  return Math.round(n * 100) / 100;
}

function qtde(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * O mês "AAAA-MM" em instantes: do primeiro dia à 0h até o primeiro do mês
 * seguinte, no horário de Brasília (UTC−3, sem horário de verão desde 2019).
 */
export function limitesDoMes(competencia: string): { inicio: Date; fim: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  const ano = m ? Number(m[1]) : NaN;
  const mes = m ? Number(m[2]) : NaN;
  if (!m || mes < 1 || mes > 12 || ano < 2000 || ano > 2100) {
    throw new Error(`Competência inválida: "${competencia}" (use AAAA-MM).`);
  }
  return {
    inicio: new Date(Date.UTC(ano, mes - 1, 1, 3)),
    fim: new Date(Date.UTC(ano, mes, 1, 3)),
  };
}
