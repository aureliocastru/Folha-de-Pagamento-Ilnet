import type { ConfigService } from '@nestjs/config';
import type { AxiosInstance } from 'axios';
import type { AppConfig } from '../config/configuration';
import { RastreamentoClient } from './rastreamento.client';

type Pedido = { url: string; method: string; params?: Record<string, unknown>; data?: unknown };

function cliente(cfg: Partial<AppConfig['rastreio']>, respostas: Array<unknown>) {
  const request = jest.fn(async (pedido: Pedido) => {
    void pedido;
    const r = respostas.shift();
    if (r instanceof Error) throw r;
    return r;
  });
  const config = {
    getOrThrow: () => ({
      url: 'http://plataformarastreamento.com.br/api',
      apiHash: '',
      email: '',
      senha: '',
      idioma: 'en',
      timeoutMs: 1000,
      ...cfg,
    }),
  } as unknown as ConfigService;
  return { rastreio: new RastreamentoClient({ request } as unknown as AxiosInstance, config), request };
}

const grupos = [{ title: 'Técnicos', items: [{ id: 1 }] }];

describe('a plataforma de rastreamento', () => {
  it('sem hash e sem e-mail e senha, não está configurada', () => {
    const { rastreio } = cliente({}, []);
    expect(rastreio.configurado).toBe(false);
    expect(rastreio.problemas()[0]).toMatch(/RASTREIO_API_HASH/);
  });

  it('com o hash pronto, lê a frota direto', async () => {
    const { rastreio, request } = cliente({ apiHash: 'h-123' }, [{ status: 200, data: grupos }]);
    expect(await rastreio.grupos()).toEqual(grupos);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      url: 'http://plataformarastreamento.com.br/api/get_devices',
      method: 'GET',
      params: { user_api_hash: 'h-123', lang: 'en' },
    });
  });

  it('com e-mail e senha, gera o hash antes', async () => {
    const { rastreio, request } = cliente({ email: 'frota@ilnet', senha: 's' }, [
      { status: 200, data: { status: 1, user_api_hash: 'novo' } },
      { status: 200, data: grupos },
    ]);
    await rastreio.grupos();
    expect(request.mock.calls[0][0]).toMatchObject({ url: expect.stringMatching(/\/login$/), method: 'POST' });
    expect(String(request.mock.calls[0][0].data)).toBe('email=frota%40ilnet&password=s');
    expect(request.mock.calls[1][0].params).toMatchObject({ user_api_hash: 'novo' });
  });

  /* O hash vence; com a senha, gera-se outro e a leitura segue. */
  it('o 401 com senha guardada gera um hash novo e tenta de novo', async () => {
    const { rastreio, request } = cliente({ apiHash: 'velho', email: 'frota@ilnet', senha: 's' }, [
      { status: 401, data: {} },
      { status: 200, data: { status: 1, user_api_hash: 'novo' } },
      { status: 200, data: grupos },
    ]);
    expect(await rastreio.grupos()).toEqual(grupos);
    expect(request.mock.calls[2][0].params).toMatchObject({ user_api_hash: 'novo' });
  });

  it('o 401 sem senha é erro dito', async () => {
    const { rastreio } = cliente({ apiHash: 'velho' }, [{ status: 401, data: {} }]);
    await expect(rastreio.grupos()).rejects.toThrow(/recusou as credenciais/);
  });

  /* O hash vai na URL: a mensagem de erro não pode levá-lo para o log. */
  it('a falha de rede cita o servidor, e não a URL com o hash', async () => {
    const { rastreio } = cliente({ apiHash: 'segredo-do-hash' }, [new Error('timeout of 1000ms exceeded')]);
    const erro = await rastreio.grupos().catch((e: Error) => e);
    expect(String((erro as Error).message)).toMatch(/plataformarastreamento\.com\.br/);
    expect(String((erro as Error).message)).not.toMatch(/segredo-do-hash/);
  });

  it('a resposta que não é a lista de grupos é recusada', async () => {
    const { rastreio } = cliente({ apiHash: 'h' }, [{ status: 200, data: { erro: 'x' } }]);
    await expect(rastreio.grupos()).rejects.toThrow(/resposta inesperada/);
  });
});
