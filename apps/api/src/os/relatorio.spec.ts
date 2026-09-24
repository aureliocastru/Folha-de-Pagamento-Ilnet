import { limitesDoMes, montarRelatorio, type ItemParaRelatorio } from './relatorio';

/**
 * O relatório do mês. O que este arquivo protege: as somas por técnico e por
 * material, a média por OS (a pergunta de "quantos conectores por OS"), o que
 * voltou com defeito, e o porquê de quem passou do normal.
 */

function item(over: Partial<ItemParaRelatorio>): ItemParaRelatorio {
  return {
    tipo: 'MATERIAL',
    tecnicoId: 't1',
    tecnico: 'Cleyson',
    osIxcId: 1,
    produtoId: 36,
    descricao: 'CONECTOR',
    unidade: 'UN',
    quantidade: 2,
    valorUnitario: 1.5,
    condicao: null,
    observacao: null,
    ...over,
  };
}

describe('montarRelatorio', () => {
  const itens = [
    item({ osIxcId: 1, quantidade: 2 }),
    item({ osIxcId: 2, quantidade: 4, observacao: 'emenda refeita' }),
    item({ osIxcId: 2, produtoId: 40, descricao: 'DROP', unidade: 'M', quantidade: 80, valorUnitario: 0.5 }),
    item({ tecnicoId: 't2', tecnico: 'Anderson', osIxcId: 3, quantidade: 1 }),
    item({ tipo: 'INSTALADO', osIxcId: 1, produtoId: 34, descricao: 'ONU', quantidade: 1, valorUnitario: 190 }),
    item({ tipo: 'RETIRADO', osIxcId: 1, produtoId: 34, descricao: 'ONU', quantidade: 1, condicao: 'DEFEITO' }),
    item({ tipo: 'RETIRADO', tecnicoId: 't2', tecnico: 'Anderson', osIxcId: 3, produtoId: 34, descricao: 'ONU', quantidade: 1, condicao: 'FUNCIONANDO' }),
    item({ tipo: 'DIVERGENCIA', tecnicoId: 't2', tecnico: 'Anderson', osIxcId: 3, produtoId: null, descricao: 'Roteador sem cadastro', quantidade: 1 }),
  ];
  const r = montarRelatorio('2026-09', itens);

  it('os totais do mês', () => {
    expect(r.totais).toEqual({
      os: 3,
      instalados: 1,
      retirados: 2,
      comDefeito: 1,
      divergencias: 1,
      // conector 7 × 1,50 + drop 80 × 0,50 — aparelho não é material
      valorMateriais: 50.5,
    });
  });

  it('por técnico, do que mais gastou para o que menos', () => {
    expect(r.porTecnico.map((t) => [t.tecnico, t.os, t.valorMateriais])).toEqual([
      ['Cleyson', 2, 49],
      ['Anderson', 1, 1.5],
    ]);
    expect(r.porTecnico[0]).toMatchObject({ instalados: 1, retirados: 1, comDefeito: 1 });
    expect(r.porTecnico[1]).toMatchObject({ retirados: 1, comDefeito: 0, divergencias: 1 });
  });

  it('por material, com a média por OS e quem gastou', () => {
    const conector = r.materiais.find((m) => m.produtoId === 36)!;
    expect(conector).toMatchObject({ quantidade: 7, valor: 10.5, os: 3 });
    expect(conector.mediaPorOs).toBeCloseTo(2.333, 3);
    expect(conector.porTecnico).toEqual([
      { tecnico: 'Cleyson', quantidade: 6 },
      { tecnico: 'Anderson', quantidade: 1 },
    ]);
  });

  it('aparelhos: instalados, retirados e com defeito, por produto', () => {
    expect(r.aparelhos).toEqual([
      { produtoId: 34, descricao: 'ONU', instalados: 1, retirados: 2, comDefeito: 1 },
    ]);
  });

  it('o porquê de quem passou do normal', () => {
    expect(r.justificativas).toEqual([
      {
        osIxcId: 2,
        tecnico: 'Cleyson',
        descricao: 'CONECTOR',
        quantidade: 4,
        unidade: 'UN',
        observacao: 'emenda refeita',
      },
    ]);
  });

  it('mês vazio não quebra', () => {
    expect(montarRelatorio('2026-10', []).totais).toEqual({
      os: 0,
      instalados: 0,
      retirados: 0,
      comDefeito: 0,
      divergencias: 0,
      valorMateriais: 0,
    });
  });
});

describe('limitesDoMes', () => {
  it('do dia 1 à 0h de Brasília até o dia 1 do mês seguinte', () => {
    expect(limitesDoMes('2026-09')).toEqual({
      inicio: new Date('2026-09-01T03:00:00.000Z'),
      fim: new Date('2026-10-01T03:00:00.000Z'),
    });
    expect(limitesDoMes('2026-12').fim).toEqual(new Date('2027-01-01T03:00:00.000Z'));
  });

  it('recusa o que não é AAAA-MM', () => {
    expect(() => limitesDoMes('09/2026')).toThrow(/AAAA-MM/);
    expect(() => limitesDoMes('2026-13')).toThrow(/AAAA-MM/);
  });
});
