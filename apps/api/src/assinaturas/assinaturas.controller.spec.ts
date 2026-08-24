import { AssinaturasController } from './assinaturas.controller';

/**
 * O que a janela de quem paga recebe.
 *
 * O controller monta a resposta campo a campo, e era aí que a recoleta morria:
 * `recoletandoDesde` nunca saía daqui, e é ele que diz se a janela mostra o
 * link novo ou o comprovante de sempre. Pior, as duas rotas devolviam recortes
 * diferentes do mesmo registro — e a janela grava a resposta por cima do que
 * tem em mãos, então pedir link novo apagava do cache o nome de quem assinou e
 * o desenho da assinatura.
 *
 * Este arquivo existe para que os dois recortes continuem sendo o mesmo.
 */
const GUARDADA = {
  id: 'a1',
  diariaId: 'dia1',
  token: 'tk-velho',
  expiraEm: new Date('2099-01-01'),
  assinadoEm: new Date('2026-08-18T11:27:00Z'),
  recoletandoDesde: null,
  recoletas: 0,
  nomeAssinante: 'Eduarda Amaral Porto',
  assinaturaPng: 'data:image/png;base64,AAAA',
  modo: 'DESENHADA',
};

function montar(overrides: Record<string, unknown> = {}) {
  const registro = { ...GUARDADA, ...overrides };
  const service = {
    doDiaria: jest.fn().mockResolvedValue(registro),
    gerarLink: jest.fn().mockResolvedValue({
      ...registro,
      token: 'tk-novo',
      recoletandoDesde: new Date('2026-08-24T10:00:00Z'),
    }),
  };
  return {
    controller: new AssinaturasController(service as never),
    service,
  };
}

const req = { user: { id: 'u1' } } as never;

describe('o recibo que a janela de quem paga recebe', () => {
  it('as duas rotas devolvem os mesmos campos', async () => {
    const { controller } = montar();

    const lido = await controller.doDiaria('dia1');
    const gerado = await controller.gerarLink('dia1', { substituir: true }, req);

    expect(Object.keys(gerado).sort()).toEqual(Object.keys(lido!).sort());
  });

  /*
   * Sem este campo, "Sim, substituir" gerava o link e a janela continuava
   * mostrando o comprovante: o clique parecia não fazer nada.
   */
  it('abrir a coleta de novo devolve que se espera outra assinatura', async () => {
    const { controller } = montar();

    const gerado = await controller.gerarLink('dia1', { substituir: true }, req);

    expect(gerado.token).toBe('tk-novo');
    expect(gerado.recoletandoDesde).toBeInstanceOf(Date);
    // A antiga continua respondendo pelo recibo até a nova chegar.
    expect(gerado.assinadoEm).toBeInstanceOf(Date);
  });

  /* A janela grava a resposta por cima: o que não vier aqui some de lá. */
  it('abrir a coleta não apaga o nome nem o desenho da assinatura', async () => {
    const { controller } = montar();

    const gerado = await controller.gerarLink('dia1', { substituir: true }, req);

    expect(gerado.nomeAssinante).toBe('Eduarda Amaral Porto');
    expect(gerado.assinaturaPng).toBe('data:image/png;base64,AAAA');
  });

  it('sem recibo nenhum, devolve nulo', async () => {
    const { controller, service } = montar();
    service.doDiaria.mockResolvedValue(null);

    expect(await controller.doDiaria('dia1')).toBeNull();
  });
});
