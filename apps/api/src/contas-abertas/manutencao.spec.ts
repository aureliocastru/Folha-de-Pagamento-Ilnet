import { itensPadrao, ordemDeAtencao, situacaoDoItem, somarMeses } from './manutencao';

/**
 * A manutenção da frota. O que este arquivo protege:
 *
 *  - o que vencer primeiro manda: km ou meses;
 *  - sem a última troca não há conta — "sem registro", e não "em dia";
 *  - com a troca mas sem o km de agora, o tempo ainda conta sozinho;
 *  - a lista padrão vem pelo tipo, e o galão não tem.
 */

const HOJE = new Date(Date.UTC(2026, 8, 23));
const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('situacaoDoItem', () => {
  const oleo = { intervaloMedidor: 10000, intervaloMeses: 12 };

  it('em dia: andou 5.000 de 10.000 km, trocado há 3 meses', () => {
    const s = situacaoDoItem(
      { ...oleo, ultimaTrocaMedidor: 100000, ultimaTrocaEm: dia('2026-06-23') },
      105000,
      HOJE,
    );
    expect(s.estado).toBe('EM_DIA');
    expect(s.faltaMedidor).toBe(5000);
    expect(s.venceComMedidor).toBe(110000);
    expect(s.venceEm).toBe('2027-06-23');
  });

  it('perto: usou 90% pelo km', () => {
    const s = situacaoDoItem(
      { ...oleo, ultimaTrocaMedidor: 100000, ultimaTrocaEm: dia('2026-08-23') },
      109200,
      HOJE,
    );
    expect(s.estado).toBe('PERTO');
    expect(s.faltaMedidor).toBe(800);
  });

  it('vencido pelo km, mesmo com o tempo folgado', () => {
    const s = situacaoDoItem(
      { ...oleo, ultimaTrocaMedidor: 100000, ultimaTrocaEm: dia('2026-09-01') },
      110300,
      HOJE,
    );
    expect(s.estado).toBe('VENCIDO');
    expect(s.faltaMedidor).toBe(-300);
  });

  it('vencido pelo tempo: o carro parado no pátio também vence o óleo', () => {
    const s = situacaoDoItem(
      { ...oleo, ultimaTrocaMedidor: 100000, ultimaTrocaEm: dia('2025-09-01') },
      100500,
      HOJE,
    );
    expect(s.estado).toBe('VENCIDO');
    expect(s.faltaDias).toBeLessThan(0);
  });

  it('sem a última troca, não chuta: sem registro', () => {
    const s = situacaoDoItem({ ...oleo, ultimaTrocaMedidor: null, ultimaTrocaEm: null }, 105000, HOJE);
    expect(s.estado).toBe('SEM_REGISTRO');
    expect(s.usado).toBeNull();
  });

  it('só por km, sem o km de agora: sem medidor', () => {
    const s = situacaoDoItem(
      { intervaloMedidor: 50000, intervaloMeses: null, ultimaTrocaMedidor: 80000, ultimaTrocaEm: null },
      null,
      HOJE,
    );
    expect(s.estado).toBe('SEM_MEDIDOR');
    expect(s.venceComMedidor).toBe(130000);
  });

  it('só por tempo (bateria de 36 meses)', () => {
    const s = situacaoDoItem(
      { intervaloMedidor: null, intervaloMeses: 36, ultimaTrocaMedidor: null, ultimaTrocaEm: dia('2024-06-10') },
      null,
      HOJE,
    );
    expect(s.estado).toBe('EM_DIA');
    expect(s.venceEm).toBe('2027-06-10');
  });

  it('máquina em horas: 240 de 250 h é perto', () => {
    const s = situacaoDoItem(
      { intervaloMedidor: 250, intervaloMeses: null, ultimaTrocaMedidor: 1011.9, ultimaTrocaEm: dia('2026-09-01') },
      1251.9,
      HOJE,
    );
    expect(s.estado).toBe('PERTO');
    expect(s.faltaMedidor).toBe(10);
  });
});

describe('somarMeses', () => {
  it('31 de janeiro + 1 mês cai no último dia de fevereiro', () => {
    expect(somarMeses(dia('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
  });
  it('atravessa o ano', () => {
    expect(somarMeses(dia('2026-11-15'), 3).toISOString().slice(0, 10)).toBe('2027-02-15');
  });
});

describe('itensPadrao', () => {
  it('cada tipo tem a sua lista, e o galão não tem nenhuma', () => {
    expect(itensPadrao('GALAO')).toHaveLength(0);
    expect(itensPadrao('MOTO').map((i) => i.nome)).toContain('Relação (corrente, coroa e pinhão)');
    expect(itensPadrao('CAMINHAO').find((i) => i.nome === 'Óleo do motor')).toMatchObject({
      medidor: 10000,
      meses: 6,
    });
    expect(itensPadrao('MAQUINA').find((i) => i.nome === 'Óleo do motor')?.medidor).toBe(250);
  });

  it('todo item padrão tem intervalo', () => {
    for (const tipo of ['MOTO', 'CARRO', 'CAMINHONETE', 'CAMINHAO', 'MAQUINA', 'OUTRO'] as const) {
      for (const i of itensPadrao(tipo)) expect(i.medidor || i.meses).toBeTruthy();
    }
  });
});

describe('ordemDeAtencao', () => {
  it('vencido, perto, sem registro, sem km, em dia', () => {
    const s = (estado: string, usado: number | null = null) =>
      ({ estado, usado }) as Parameters<typeof ordemDeAtencao>[0];
    const lista = [s('EM_DIA', 0.2), s('SEM_REGISTRO'), s('VENCIDO', 1.1), s('PERTO', 0.95), s('SEM_MEDIDOR')];
    expect(lista.sort(ordemDeAtencao).map((x) => x.estado)).toEqual([
      'VENCIDO',
      'PERTO',
      'SEM_REGISTRO',
      'SEM_MEDIDOR',
      'EM_DIA',
    ]);
  });
});
