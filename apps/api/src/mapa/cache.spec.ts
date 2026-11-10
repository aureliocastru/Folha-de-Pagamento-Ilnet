import { cacheComReserva, CachePorId } from './cache';

describe('cache com reserva', () => {
  let agora = 1_000_000;
  const relogio = () => agora;
  beforeEach(() => {
    agora = 1_000_000;
  });

  it('dez telas ao mesmo tempo são uma consulta só', async () => {
    const buscar = jest.fn(async () => ({ n: 1 }));
    const obter = cacheComReserva(60_000, buscar, relogio);
    const respostas = await Promise.all(Array.from({ length: 10 }, () => obter()));
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(respostas.every((r) => r.n === 1 && r.erro === null)).toBe(true);
  });

  it('dentro do prazo não vai à fonte; vencido, vai', async () => {
    let leituras = 0;
    const obter = cacheComReserva(60_000, async () => ({ n: ++leituras }), relogio);
    await obter();
    agora += 59_000;
    expect((await obter()).n).toBe(1);
    agora += 2_000;
    expect((await obter()).n).toBe(2);
  });

  /* A fonte caiu: o mapa segue com o último dado bom, dizendo que é ele. */
  it('a falha devolve o dado anterior, marcado com o erro', async () => {
    let falhar = false;
    const obter = cacheComReserva(
      60_000,
      async () => {
        if (falhar) throw new Error('IXC fora do ar');
        return { n: 1 };
      },
      relogio,
    );
    const primeiro = await obter();
    falhar = true;
    agora += 61_000;
    const segundo = await obter();
    expect(segundo).toMatchObject({ n: 1, erro: 'IXC fora do ar', atualizadoEm: primeiro.atualizadoEm });
  });

  it('sem dado anterior, a falha sobe', async () => {
    const obter = cacheComReserva(60_000, async () => Promise.reject(new Error('fora')), relogio);
    await expect(obter()).rejects.toThrow('fora');
  });

  it('invalidar faz a próxima chamada ir à fonte', async () => {
    const buscar = jest.fn(async () => ({ n: 1 }));
    const obter = cacheComReserva(60_000, buscar, relogio);
    await obter();
    obter.invalidar();
    await obter();
    expect(buscar).toHaveBeenCalledTimes(2);
  });
});

describe('cache por id', () => {
  it('só vai à fonte o id que falta, e guarda o que não existe', async () => {
    const buscar = jest.fn(async (ids: number[]) => new Map(ids.filter((id) => id !== 3).map((id) => [id, `c${id}`])));
    const cache = new CachePorId<string>(60_000, buscar, () => 0);
    expect([...(await cache.obter([1, 2, 3, 1, 0]))]).toEqual([
      [1, 'c1'],
      [2, 'c2'],
    ]);
    await cache.obter([2, 3, 4]);
    expect(buscar.mock.calls).toEqual([[[1, 2, 3]], [[4]]]);
  });
});
