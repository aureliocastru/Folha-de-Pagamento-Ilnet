import { colaboradorDoIxc, resolverAlmoxDoTecnico, type CadastroLocal } from './tecnicos';

/**
 * De que almoxarifado sai o material do técnico. O que este arquivo protege:
 *
 *  - o caminho do IXC: colaborador → usuário → ligação padrão;
 *  - o fixado à mão vence, mas tem de ser um que o sistema enxerga;
 *  - Perdas, Saídas e a triagem nunca são a van de ninguém;
 *  - quando o IXC não diz um só, a resposta diz o que falta — e não escolhe.
 */

const almoxarifados = [
  { id: 1, nome: 'Almoxarifado Principal', filialId: 1, ativo: true },
  { id: 12, nome: 'VAN CLEYSON', filialId: 1, ativo: true },
  { id: 13, nome: 'VAN ANDERSON', filialId: 1, ativo: true },
  { id: 43, nome: 'Perdas e Falhas', filialId: 1, ativo: true },
  { id: 60, nome: 'Recolhidos (triagem)', filialId: 1, ativo: true },
  { id: 70, nome: 'VAN VELHA', filialId: 1, ativo: false },
];

const usuarios = [
  { id: 6, funcionarioId: 17, ativo: true },
  { id: 7, funcionarioId: 18, ativo: true },
  { id: 8, funcionarioId: 19, ativo: false },
];

describe('resolverAlmoxDoTecnico', () => {
  it('acha a ligação padrão do usuário do colaborador', () => {
    expect(
      resolverAlmoxDoTecnico({
        ixcId: 17,
        usuarios,
        ligacoes: [
          { usuarioId: 6, almoxId: 1, padrao: false },
          { usuarioId: 6, almoxId: 12, padrao: true },
        ],
        almoxarifados,
      }),
    ).toEqual({ ok: true, almoxId: 12, nome: 'VAN CLEYSON', filialId: 1, origem: 'padrao' });
  });

  it('sem padrão, mas uma ligação só (fora Perdas e triagem): é ela', () => {
    const r = resolverAlmoxDoTecnico({
      ixcId: 17,
      usuarios,
      ligacoes: [
        { usuarioId: 6, almoxId: 12, padrao: false },
        { usuarioId: 6, almoxId: 43, padrao: false },
        { usuarioId: 6, almoxId: 60, padrao: false },
      ],
      almoxarifados,
    });
    expect(r).toMatchObject({ ok: true, almoxId: 12, origem: 'unico' });
  });

  it('sem padrão e com mais de uma: não escolhe, diz o que fazer', () => {
    const r = resolverAlmoxDoTecnico({
      ixcId: 17,
      usuarios,
      ligacoes: [
        { usuarioId: 6, almoxId: 1, padrao: false },
        { usuarioId: 6, almoxId: 12, padrao: false },
      ],
      almoxarifados,
    });
    expect(r).toMatchObject({ ok: false, motivo: expect.stringMatching(/nenhum é o padrão/) });
    expect(r.ok ? [] : r.candidatos.map((c) => c.id)).toEqual([1, 12]);
  });

  it('dois padrões (dois usuários do mesmo colaborador): não escolhe', () => {
    const r = resolverAlmoxDoTecnico({
      ixcId: 17,
      usuarios: [...usuarios, { id: 9, funcionarioId: 17, ativo: true }],
      ligacoes: [
        { usuarioId: 6, almoxId: 12, padrao: true },
        { usuarioId: 9, almoxId: 13, padrao: true },
      ],
      almoxarifados,
    });
    expect(r).toMatchObject({ ok: false, motivo: expect.stringMatching(/2 almoxarifados padrão/) });
  });

  it('o fixado à mão vence o do IXC', () => {
    expect(
      resolverAlmoxDoTecnico({
        ixcId: 17,
        fixado: { almoxId: 13, nome: 'VAN ANDERSON' },
        usuarios,
        ligacoes: [{ usuarioId: 6, almoxId: 12, padrao: true }],
        almoxarifados,
      }),
    ).toMatchObject({ ok: true, almoxId: 13, origem: 'fixado' });
  });

  it('fixado num que o sistema não enxerga, ou desativado: recusa', () => {
    const sem = { ixcId: 17, usuarios, ligacoes: [], almoxarifados };
    expect(resolverAlmoxDoTecnico({ ...sem, fixado: { almoxId: 99, nome: 'VAN X' } })).toMatchObject({
      ok: false,
      motivo: expect.stringMatching(/não está liberado/),
    });
    expect(resolverAlmoxDoTecnico({ ...sem, fixado: { almoxId: 70, nome: 'VAN VELHA' } })).toMatchObject({
      ok: false,
      motivo: expect.stringMatching(/desativado/),
    });
  });

  it('sem colaborador do IXC, sem usuário, ou com o usuário desativado: diz o que falta', () => {
    expect(
      resolverAlmoxDoTecnico({ ixcId: 0, usuarios, ligacoes: [], almoxarifados }),
    ).toMatchObject({ ok: false, motivo: expect.stringMatching(/não está ligado a um colaborador/) });
    expect(
      resolverAlmoxDoTecnico({ ixcId: 99, usuarios, ligacoes: [], almoxarifados }),
    ).toMatchObject({ ok: false, motivo: expect.stringMatching(/Nenhum usuário ativo/) });
    expect(
      resolverAlmoxDoTecnico({
        ixcId: 19,
        usuarios,
        ligacoes: [{ usuarioId: 8, almoxId: 12, padrao: true }],
        almoxarifados,
      }),
    ).toMatchObject({ ok: false, motivo: expect.stringMatching(/Nenhum usuário ativo/) });
  });

  it('o padrão dele é um que o sistema não enxerga: pede para liberar', () => {
    expect(
      resolverAlmoxDoTecnico({
        ixcId: 18,
        usuarios,
        ligacoes: [{ usuarioId: 7, almoxId: 88, padrao: true }],
        almoxarifados,
      }),
    ).toMatchObject({ ok: false, motivo: expect.stringMatching(/Libere na aba Almoxarifados/) });
  });
});

describe('colaboradorDoIxc — a mesma pessoa em dois cadastros', () => {
  // Como a base real ficou em 24/09/2026: o do fornecedor (o da folha e do
  // login) sem ixcId, e o de `funcionarios` com ele.
  const doFornecedor: CadastroLocal = {
    id: 'f-forn',
    nome: 'Cleyson Oliveira Pereira',
    cpfCnpj: '123.456.789-09',
    ixcId: null,
    ativo: true,
  };
  const deFuncionarios = (over: Partial<CadastroLocal> = {}): CadastroLocal => ({
    id: 'f-func',
    nome: 'Cleyson Oliveira Pereira',
    cpfCnpj: null,
    ixcId: 46,
    ativo: true,
    ...over,
  });

  it('o próprio ixcId vence', () => {
    expect(colaboradorDoIxc({ ...doFornecedor, ixcId: 7 }, [deFuncionarios()])).toBe(7);
  });

  it('acha o gêmeo pelo CPF, mesmo com o nome escrito diferente', () => {
    expect(
      colaboradorDoIxc(doFornecedor, [deFuncionarios({ nome: 'CLEYSON O. PEREIRA', cpfCnpj: '12345678909' })]),
    ).toBe(46);
  });

  it('sem CPF do outro lado, acha pelo nome completo — sem acento e sem diferença de maiúscula', () => {
    expect(colaboradorDoIxc(doFornecedor, [deFuncionarios({ nome: 'cleyson  oliveira pereira' })])).toBe(46);
    expect(
      colaboradorDoIxc({ ...doFornecedor, nome: 'Alisson Matheus da Conceição' }, [
        deFuncionarios({ nome: 'Alisson Matheus da Conceicao', ixcId: 57 }),
      ]),
    ).toBe(57);
  });

  it('dois com o mesmo nome é dúvida: não escolhe', () => {
    expect(
      colaboradorDoIxc(doFornecedor, [deFuncionarios(), deFuncionarios({ id: 'f-outro', ixcId: 99 })]),
    ).toBeNull();
  });

  it('nome de uma palavra só, ou gêmeo desativado, não servem', () => {
    expect(colaboradorDoIxc({ ...doFornecedor, nome: 'Cleyson', cpfCnpj: null }, [deFuncionarios({ nome: 'Cleyson' })])).toBeNull();
    expect(colaboradorDoIxc({ ...doFornecedor, cpfCnpj: null }, [deFuncionarios({ ativo: false })])).toBeNull();
  });
});
