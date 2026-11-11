import { EnderecoDoIxc, type Endereco, type Fontes } from './endereco-do-ixc';

const IXC: Endereco[] = [{ address: '203.0.113.2', family: 4 }];
const EAI_AGAIN = Object.assign(new Error('getaddrinfo EAI_AGAIN ixc.exemplo'), {
  code: 'EAI_AGAIN',
});

function montar(inicio: Partial<Fontes> = {}) {
  let relogio = 1_000_000;
  const fontes = {
    sistema: jest.fn<Promise<Endereco[]>, [string]>().mockResolvedValue(IXC),
    publico: jest.fn<Promise<Endereco[]>, [string]>().mockResolvedValue(IXC),
    agora: () => relogio,
    ...inicio,
  };
  return {
    fontes,
    endereco: new EnderecoDoIxc(fontes),
    passar: (ms: number) => {
      relogio += ms;
    },
  };
}

describe('EnderecoDoIxc', () => {
  it('usa o DNS do servidor e não pergunta de novo enquanto o endereço vale', async () => {
    const { endereco, fontes, passar } = montar();

    expect(await endereco.achar('ixc.exemplo')).toEqual(IXC);
    passar(60_000);
    expect(await endereco.achar('ixc.exemplo')).toEqual(IXC);

    expect(fontes.sistema).toHaveBeenCalledTimes(1);
    expect(fontes.publico).not.toHaveBeenCalled();
  });

  it('com o DNS do servidor falhando, pergunta a um DNS público', async () => {
    const { endereco, fontes } = montar({
      sistema: jest.fn().mockRejectedValue(EAI_AGAIN),
    });

    expect(await endereco.achar('ixc.exemplo')).toEqual(IXC);
    expect(fontes.publico).toHaveBeenCalledWith('ixc.exemplo');
  });

  it('depois de uma falha, deixa o DNS do servidor descansar um minuto antes de tentar nele de novo', async () => {
    const sistema = jest.fn().mockRejectedValue(EAI_AGAIN);
    const { endereco, passar } = montar({ sistema });

    await endereco.achar('ixc.exemplo');
    passar(5 * 60_000 + 1); // o guardado venceu…
    sistema.mockResolvedValue(IXC);
    passar(0);
    await endereco.achar('ixc.exemplo'); // …e o descanso de 1 min também
    expect(sistema).toHaveBeenCalledTimes(2);
  });

  it('sem DNS nenhum, segue com o último endereço que funcionou', async () => {
    const sistema = jest.fn().mockResolvedValue(IXC);
    const publico = jest.fn().mockRejectedValue(new Error('ETIMEOUT'));
    const { endereco, passar } = montar({ sistema, publico });

    await endereco.achar('ixc.exemplo');
    passar(60 * 60_000);
    sistema.mockRejectedValue(EAI_AGAIN);

    expect(await endereco.achar('ixc.exemplo')).toEqual(IXC);
  });

  it('sem DNS e sem endereço guardado, devolve o erro do DNS do servidor', async () => {
    const { endereco } = montar({
      sistema: jest.fn().mockRejectedValue(EAI_AGAIN),
      publico: jest.fn().mockRejectedValue(new Error('ETIMEOUT')),
    });

    await expect(endereco.achar('ixc.exemplo')).rejects.toBe(EAI_AGAIN);
  });

  it('várias conexões abrindo juntas fazem uma pergunta só', async () => {
    const { endereco, fontes } = montar();

    await Promise.all([1, 2, 3, 4].map(() => endereco.achar('ixc.exemplo')));

    expect(fontes.sistema).toHaveBeenCalledTimes(1);
  });

  it('endereço numérico passa direto, sem DNS', async () => {
    const { endereco, fontes } = montar();

    expect(await endereco.achar('203.0.113.9')).toEqual([{ address: '203.0.113.9', family: 4 }]);
    expect(fontes.sistema).not.toHaveBeenCalled();
  });

  it('responde ao agente do Node nos dois formatos: um endereço ou a lista', async () => {
    const { endereco } = montar();

    const um = await new Promise((ok) =>
      endereco.lookup('ixc.exemplo', {}, (_e, a, f) => ok([a, f])),
    );
    const lista = await new Promise((ok) =>
      endereco.lookup('ixc.exemplo', { all: true }, (_e, a) => ok(a)),
    );

    expect(um).toEqual(['203.0.113.2', 4]);
    expect(lista).toEqual(IXC);
  });
});
