import { createIxcHttp, recusarEscrita } from './ixc.http';
import { validateEnv } from '../config/configuration';

/**
 * O modo só leitura do IXC. O que este arquivo protege: com a trava ligada,
 * nenhuma escrita sai do app — nem inserir, nem editar, nem apagar, nem botão
 * —, e a listagem continua passando.
 */

describe('IXC_SOMENTE_LEITURA', () => {
  it('a listagem (GET) passa; POST, PUT e DELETE são recusados antes de sair', () => {
    expect(recusarEscrita({ method: 'get', url: '/su_oss_chamado' })).toEqual({
      method: 'get',
      url: '/su_oss_chamado',
    });
    for (const method of ['post', 'PUT', 'delete']) {
      expect(() => recusarEscrita({ method, url: '/su_oss_mov_produto' })).toThrow(
        /modo só leitura.*su_oss_mov_produto/,
      );
    }
  });

  it('com a trava ligada, a escrita nem chega à rede', async () => {
    const http = createIxcHttp({ host: 'ixc.invalido', token: '1:x', timeoutMs: 1000, somenteLeitura: true });
    await expect(http.request({ url: '/fn_apagar', method: 'post', data: {} })).rejects.toThrow(
      /modo só leitura/,
    );
  });

  it('o .env liga com "1" ou "true", e fica desligado por padrão', () => {
    const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(20) };
    expect(validateEnv(base).IXC_SOMENTE_LEITURA).toBe(false);
    expect(validateEnv({ ...base, IXC_SOMENTE_LEITURA: '1' }).IXC_SOMENTE_LEITURA).toBe(true);
    expect(validateEnv({ ...base, IXC_SOMENTE_LEITURA: 'true' }).IXC_SOMENTE_LEITURA).toBe(true);
    expect(validateEnv({ ...base, IXC_SOMENTE_LEITURA: '0' }).IXC_SOMENTE_LEITURA).toBe(false);
  });
});
