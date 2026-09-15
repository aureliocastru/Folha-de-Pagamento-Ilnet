import { lerPermissoes } from '../auth/permissoes';
import { cifrarSenha, decifrarSenha, gerarSenha } from './cifra-de-senha';

/**
 * A senha que o administrador vê. O que se protege:
 *
 *  - a cifra volta para a mesma senha, e com outro segredo não volta nada;
 *  - a senha gerada não traz letra que se confunde ao passar por mensagem;
 *  - perfil com módulo desconhecido ou nível estranho não ganha acesso.
 */
describe('cifra da senha', () => {
  it('cifra e decifra com o mesmo segredo', () => {
    const guardada = cifrarSenha('Hilux@2026', 'segredo-do-sistema');
    expect(guardada).not.toContain('Hilux');
    expect(decifrarSenha(guardada, 'segredo-do-sistema')).toBe('Hilux@2026');
  });

  it('com o segredo trocado, não lê — e não inventa', () => {
    const guardada = cifrarSenha('Hilux@2026', 'segredo-do-sistema');
    expect(decifrarSenha(guardada, 'outro-segredo')).toBeNull();
    expect(decifrarSenha('lixo', 'segredo-do-sistema')).toBeNull();
  });

  it('a mesma senha cifra diferente a cada vez', () => {
    expect(cifrarSenha('abc12345', 's')).not.toBe(cifrarSenha('abc12345', 's'));
  });

  it('senha gerada: dez caracteres, sem 0, O, 1, l ou I', () => {
    for (let i = 0; i < 50; i++) {
      const s = gerarSenha();
      expect(s).toHaveLength(10);
      expect(s).not.toMatch(/[0O1lI]/);
    }
  });
});

describe('permissões do perfil', () => {
  it('módulo que não veio, ou nível estranho, fica fechado', () => {
    expect(lerPermissoes({ almoxarifado: 'mexer', folha: 'tudo', inventado: 'mexer' })).toEqual({
      folha: 'nao',
      'contas-pagar': 'nao',
      rh: 'nao',
      seguranca: 'nao',
      almoxarifado: 'mexer',
    });
  });
});
