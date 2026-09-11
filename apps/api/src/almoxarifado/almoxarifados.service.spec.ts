import { AlmoxarifadosService } from './almoxarifados.service';

/**
 * O cadastro de almoxarifados. No IXC cada usuário só enxerga os
 * almoxarifados ligados a ele (`almox_usuario`) — inclusive o usuário do
 * token da API. O que se protege aqui:
 *
 *  - listar junta o `almox` visível, o saldo e as ligações, e diz de quem é
 *    cada um;
 *  - criar liga o novo ao sistema, a quem vê o principal e ao técnico — sem
 *    ligação ele nasceria invisível para todo mundo;
 *  - editar o de um técnico liga o sistema a ele antes;
 *  - liberar só acrescenta a ligação do sistema, e não repete a que existe;
 *  - ligar, tirar e o padrão mexem na ligação (`almox_usuario`) — e o padrão,
 *    que no IXC é do usuário e um só por pessoa, sai dos outros ao entrar aqui.
 */

const SISTEMA = 7; // o token de teste é "7:hash"

// O que o usuário do sistema enxerga em `almox`.
const VISIVEIS = [
  { id: '1', descricao: 'Almoxarifado Principal', id_filial: '1', ativo: 'S' },
  { id: '2', descricao: 'Garagem', id_filial: '1', ativo: 'N' },
];

const FILIAIS = [{ id: '1', filial: 'Matriz' }];

const VINCULOS = [
  { id: '1', id_usuario: '7', id_almox: '1', padrao_usuario: 'N' }, // o sistema
  { id: '2', id_usuario: '3', id_almox: '1', padrao_usuario: 'S' }, // o gerente vê o principal
  { id: '3', id_usuario: '52', id_almox: '29', padrao_usuario: 'S' }, // a van do Cleyson
  { id: '4', id_usuario: '3', id_almox: '2', padrao_usuario: 'N' }, // o gerente vê a garagem
];

const USUARIOS: Record<string, Record<string, string>> = {
  '7': { id: '7', nome: 'ILNET FINANCE', status: 'A', funcionario: '0' }, // o sistema
  '3': { id: '3', nome: 'Marco Aurelio', status: 'A', funcionario: '0' },
  '52': { id: '52', nome: 'Cleyson Oliveira Pereira', status: 'A', funcionario: '46' },
  '60': { id: '60', nome: 'Lucas Novo', status: 'A', funcionario: '50' },
};

function montar(opts: { doSaldo?: Array<{ id: number; nome: string }> } = {}) {
  const almoxPorId = new Map<string, Record<string, string>>(VISIVEIS.map((a) => [a.id, a]));
  const vinculos = [...VINCULOS];
  const ixc = {
    listAll: jest.fn(async (tabela: string) => {
      if (tabela === 'almox') return [...almoxPorId.values()];
      if (tabela === 'filial') return FILIAIS;
      if (tabela === 'almox_usuario') return vinculos;
      if (tabela === 'usuarios') return Object.values(USUARIOS);
      return [];
    }),
    getById: jest.fn(async (tabela: string, _campo: string, id: number | string) => {
      if (tabela === 'almox') return almoxPorId.get(String(id)) ?? null;
      if (tabela === 'usuarios') return USUARIOS[String(id)] ?? null;
      if (tabela === 'almox_usuario') return vinculos.find((v) => v.id === String(id)) ?? null;
      return null;
    }),
    create: jest.fn(async (tabela: string, corpo: Record<string, string>) => {
      if (tabela === 'almox') {
        almoxPorId.set('44', { id: '44', ...corpo });
        return { id: 44, raw: {} };
      }
      vinculos.push({ id: String(vinculos.length + 1), ...corpo } as never);
      return { id: vinculos.length, raw: {} };
    }),
    update: jest.fn(async (tabela: string, id: number | string, corpo: Record<string, string>) => {
      if (tabela === 'almox_usuario') {
        const i = vinculos.findIndex((v) => v.id === String(id));
        if (i >= 0) vinculos[i] = { ...vinculos[i], ...corpo };
      }
      return { type: 'success' };
    }),
    remove: jest.fn(async (tabela: string, id: number | string) => {
      if (tabela === 'almox_usuario') {
        const i = vinculos.findIndex((v) => v.id === String(id));
        if (i >= 0) vinculos.splice(i, 1);
      }
      return { type: 'success' };
    }),
  };
  const estoque = { almoxarifadosConhecidos: jest.fn(async () => opts.doSaldo ?? []) };
  const config = { get: jest.fn(() => ({ token: `${SISTEMA}:hash` })) };
  const service = new AlmoxarifadosService(ixc as never, estoque as never, config as never);
  return { service, ixc, estoque, almoxPorId, vinculos };
}

const eu = { nome: 'Administrador' };

describe('AlmoxarifadosService.listar', () => {
  it('junta visíveis, saldo e ligações, e diz de quem é cada um', async () => {
    const { service } = montar({ doSaldo: [{ id: 29, nome: 'CLEYSON' }] });
    const lista = await service.listar();

    expect(lista.map((a) => a.id)).toEqual([1, 29, 2]); // por nome
    expect(lista.find((a) => a.id === 1)).toEqual({
      id: 1,
      descricao: 'Almoxarifado Principal',
      filialId: 1,
      filial: 'Matriz',
      ativo: true,
      liberado: true,
      // O usuário do sistema não aparece: ele é o próprio sistema.
      usuarios: [{ id: 3, nome: 'Marco Aurelio', padrao: true }],
    });
    expect(lista.find((a) => a.id === 29)).toMatchObject({
      descricao: 'CLEYSON',
      liberado: false,
      usuarios: [{ id: 52, nome: 'Cleyson Oliveira Pereira', padrao: true }],
    });
  });

  it('não quebra se o saldo falhar', async () => {
    const { service, estoque } = montar();
    estoque.almoxarifadosConhecidos.mockRejectedValue(new Error('IXC fora do ar'));
    const lista = await service.listar();
    // O 29 veio só pela ligação — sem o saldo, sem o nome dele também.
    expect(lista.find((a) => a.id === 29)).toMatchObject({
      descricao: 'Almoxarifado 29',
      liberado: false,
    });
    expect(lista).toHaveLength(3);
  });
});

describe('AlmoxarifadosService.criar', () => {
  it('liga o novo ao sistema e a quem enxerga o principal', async () => {
    const { service, ixc } = montar();
    const criado = await service.criar({ descricao: 'Depósito', filialId: 1 }, eu);

    expect(ixc.create).toHaveBeenCalledWith(
      'almox',
      expect.objectContaining({ descricao: 'Depósito', id_filial: '1', ativo: 'S' }),
    );
    expect(ixc.create).toHaveBeenCalledWith('almox_usuario', {
      id_usuario: '7',
      id_almox: '44',
      padrao_usuario: 'N',
    });
    expect(ixc.create).toHaveBeenCalledWith('almox_usuario', {
      id_usuario: '3',
      id_almox: '44',
      padrao_usuario: 'N',
    });
    expect(criado).toMatchObject({ id: 44, filial: 'Matriz', liberado: true });
  });

  it('a van de um técnico sem padrão vira o padrão dele', async () => {
    const { service, ixc } = montar();
    await service.criar({ descricao: 'LUCAS', filialId: 1, tecnicoUsuarioId: 60 }, eu);
    expect(ixc.create).toHaveBeenCalledWith('almox_usuario', {
      id_usuario: '60',
      id_almox: '44',
      padrao_usuario: 'S',
    });
  });

  it('técnico que já tem padrão não perde o dele', async () => {
    const { service, ixc } = montar();
    await service.criar({ descricao: 'CLEYSON 2', filialId: 1, tecnicoUsuarioId: 52 }, eu);
    expect(ixc.create).toHaveBeenCalledWith('almox_usuario', {
      id_usuario: '52',
      id_almox: '44',
      padrao_usuario: 'N',
    });
  });

  it('recusa quando o IXC não devolve o cadastro', async () => {
    const { service, ixc } = montar();
    ixc.create.mockImplementation(async (tabela: string) =>
      tabela === 'almox' ? { id: 999, raw: {} } : { id: 1, raw: {} },
    );
    await expect(service.criar({ descricao: 'Sumiu', filialId: 1 }, eu)).rejects.toThrow(
      /não apareceu no IXC/,
    );
  });
});

describe('AlmoxarifadosService.editar', () => {
  it('lê o registro e manda o cadastro inteiro de volta', async () => {
    const { service, ixc } = montar();
    await service.editar(2, { ativo: true }, eu);
    expect(ixc.update).toHaveBeenCalledWith(
      'almox',
      2,
      expect.objectContaining({ descricao: 'Garagem', ativo: 'S' }),
    );
  });

  it('o de um técnico: liga o sistema a ele antes de editar', async () => {
    const { service, ixc, almoxPorId } = montar();
    // Depois da ligação, o IXC passa a devolvê-lo ao sistema.
    ixc.create.mockImplementation(async (tabela: string) => {
      if (tabela === 'almox_usuario') {
        almoxPorId.set('29', { id: '29', descricao: 'CLEYSON', id_filial: '1', ativo: 'S' });
      }
      return { id: 1, raw: {} };
    });
    await service.editar(29, { descricao: 'CLEYSON VAN' }, eu);
    expect(ixc.create).toHaveBeenCalledWith('almox_usuario', {
      id_usuario: '7',
      id_almox: '29',
      padrao_usuario: 'N',
    });
    expect(ixc.update).toHaveBeenCalledWith(
      'almox',
      29,
      expect.objectContaining({ descricao: 'CLEYSON VAN' }),
    );
  });
});

describe('AlmoxarifadosService.liberar', () => {
  it('liga o sistema só aos que ele não enxerga', async () => {
    const { service, ixc } = montar({ doSaldo: [{ id: 29, nome: 'CLEYSON' }] });
    const r = await service.liberar(eu);
    expect(r).toEqual({ liberados: 1 });
    expect(ixc.create).toHaveBeenCalledTimes(1);
    expect(ixc.create).toHaveBeenCalledWith('almox_usuario', {
      id_usuario: '7',
      id_almox: '29',
      padrao_usuario: 'N',
    });
  });
});

describe('AlmoxarifadosService.apagar', () => {
  it('traduz a recusa do IXC em conselho de desativar', async () => {
    const { service, ixc } = montar();
    ixc.remove.mockRejectedValue(new Error('registro em uso'));
    await expect(service.apagar(2, eu)).rejects.toThrow(/desative-o/);
  });
});

describe('AlmoxarifadosService.ligarUsuario', () => {
  it('liga quem não estava, sem mexer no padrão de ninguém', async () => {
    const { service, ixc } = montar();
    await service.ligarUsuario(2, 60, false, eu);
    expect(ixc.create).toHaveBeenCalledWith('almox_usuario', {
      id_usuario: '60',
      id_almox: '2',
      padrao_usuario: 'N',
    });
    expect(ixc.update).not.toHaveBeenCalled();
  });

  it('ligando como padrão, o padrão sai dos outros almoxarifados da pessoa', async () => {
    const { service, ixc, vinculos } = montar();
    await service.ligarUsuario(29, 3, true, eu);

    expect(ixc.create).toHaveBeenCalledWith('almox_usuario', {
      id_usuario: '3',
      id_almox: '29',
      padrao_usuario: 'S',
    });
    // O principal era o padrão dele; deixou de ser.
    expect(ixc.update).toHaveBeenCalledWith(
      'almox_usuario',
      2,
      expect.objectContaining({ id_almox: '1', padrao_usuario: 'N' }),
    );
    expect(vinculos.find((v) => v.id === '2')?.padrao_usuario).toBe('N');
  });

  it('recusa quem já está ligado', async () => {
    const { service, ixc } = montar();
    await expect(service.ligarUsuario(1, 3, false, eu)).rejects.toThrow(/já está ligado/);
    expect(ixc.create).not.toHaveBeenCalled();
  });
});

describe('AlmoxarifadosService.desligarUsuario', () => {
  it('tira a ligação pelo id dela', async () => {
    const { service, ixc, vinculos } = montar();
    await service.desligarUsuario(1, 3, eu);
    expect(ixc.remove).toHaveBeenCalledWith('almox_usuario', 2);
    expect(vinculos.some((v) => v.id === '2')).toBe(false);
  });

  it('não tira o usuário do sistema — o almoxarifado sumiria da tela', async () => {
    const { service, ixc } = montar();
    await expect(service.desligarUsuario(1, SISTEMA, eu)).rejects.toThrow(/o sistema usa/);
    expect(ixc.remove).not.toHaveBeenCalled();
  });

  it('recusa quem já não está ligado', async () => {
    const { service } = montar();
    await expect(service.desligarUsuario(2, 52, eu)).rejects.toThrow(/já não está ligado/);
  });
});

describe('AlmoxarifadosService.definirPadrao', () => {
  it('marcar aqui tira a marca do outro almoxarifado da pessoa', async () => {
    const { service, vinculos } = montar();
    await service.definirPadrao(2, 3, true, eu);
    expect(vinculos.find((v) => v.id === '4')?.padrao_usuario).toBe('S'); // a garagem
    expect(vinculos.find((v) => v.id === '2')?.padrao_usuario).toBe('N'); // o principal
  });

  it('desmarcar deixa a pessoa sem padrão nenhum', async () => {
    const { service, vinculos } = montar();
    await service.definirPadrao(1, 3, false, eu);
    expect(vinculos.find((v) => v.id === '2')?.padrao_usuario).toBe('N');
    expect(vinculos.filter((v) => v.id_usuario === '3' && v.padrao_usuario === 'S')).toEqual([]);
  });

  it('quem não está ligado não pode ser padrão', async () => {
    const { service } = montar();
    await expect(service.definirPadrao(2, 52, true, eu)).rejects.toThrow(/antes de marcá-lo/);
  });
});

describe('opcoes', () => {
  it('técnico é o usuário ativo ligado a um colaborador — e só id e nome', async () => {
    const { service } = montar();
    const { tecnicos } = await service.opcoes();
    expect(tecnicos).toEqual([
      { id: 52, nome: 'Cleyson Oliveira Pereira' },
      { id: 60, nome: 'Lucas Novo' },
    ]);
  });

  it('os usuários para ligar são os ativos, menos o próprio sistema', async () => {
    const { service } = montar();
    const { usuarios } = await service.opcoes();
    expect(usuarios).toEqual([
      { id: 52, nome: 'Cleyson Oliveira Pereira' },
      { id: 60, nome: 'Lucas Novo' },
      { id: 3, nome: 'Marco Aurelio' },
    ]);
  });
});
