import { LENTO_MS, Medidor } from './medidor';

describe('Medidor', () => {
  it('soma as chamadas por chave e guarda a média, o pior caso e as lentas', () => {
    const m = new Medidor();
    m.anotar('rota', 'GET /api/x', 100);
    m.anotar('rota', 'GET /api/x', 300);
    m.anotar('rota', 'GET /api/x', LENTO_MS + 500);

    expect(m.resumo('rota')).toEqual([
      {
        onde: 'GET /api/x',
        vezes: 3,
        mediaMs: Math.round((400 + LENTO_MS + 500) / 3),
        piorMs: LENTO_MS + 500,
        lentas: 1,
        totalS: Math.round((400 + LENTO_MS + 500) / 1000),
      },
    ]);
  });

  it('põe primeiro quem mais pesa no tempo somado, e não mistura rota com IXC', () => {
    const m = new Medidor();
    m.anotar('rota', 'GET /api/rapida', 50);
    for (let i = 0; i < 4; i++) m.anotar('rota', 'GET /api/pesada', 2_000);
    m.anotar('ixc', 'GET fn_apagar', 900);

    expect(m.resumo('rota').map((l) => l.onde)).toEqual(['GET /api/pesada', 'GET /api/rapida']);
    expect(m.resumo('ixc').map((l) => l.onde)).toEqual(['GET fn_apagar']);
  });

  it('para de criar chaves no teto, sem perder as que já tem', () => {
    const m = new Medidor();
    for (let i = 0; i < 700; i++) m.anotar('rota', `GET /api/${i}`, 10);
    m.anotar('rota', 'GET /api/0', 10);

    const tudo = m.resumo('rota', 10_000);
    expect(tudo).toHaveLength(600);
    expect(tudo.find((l) => l.onde === 'GET /api/0')?.vezes).toBe(2);
  });
});
