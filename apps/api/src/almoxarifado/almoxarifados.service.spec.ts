import { AlmoxarifadosService } from './almoxarifados.service';

/**
 * O cadastro de almoxarifados. O que se protege aqui:
 *
 *  - listar junta a tabela `almox` com o nome da filial;
 *  - editar lê o registro antes e manda o cadastro inteiro de volta;
 *  - apagar traduz a recusa do IXC em conselho de desativar.
 */

const ALMOX = [
  { id: '1', descricao: 'Estoque central', id_filial: '1', ativo: 'S' },
  { id: '2', descricao: 'Van do Anderson', id_filial: '1', ativo: 'N' },
];

const FILIAIS = [{ id: '1', filial: 'Matriz' }];

function montar(doSaldo: Array<{ id: number; nome: string }> = []) {
  const ixc = {
    listAll: jest.fn(async (tabela: string) => {
      if (tabela === 'almox') return ALMOX;
      if (tabela === 'filial') return FILIAIS;
      return [];
    }),
    getById: jest.fn(async () => ALMOX[1]),
    create: jest.fn(async () => ({ id: 3, raw: {} })),
    update: jest.fn(async () => ({ type: 'success' })),
    remove: jest.fn(async () => ({ type: 'success' })),
  };
  const estoque = { almoxarifadosConhecidos: jest.fn(async () => doSaldo) };
  const service = new AlmoxarifadosService(ixc as never, estoque as never);
  return { service, ixc, estoque };
}

const eu = { nome: 'Administrador' };

describe('AlmoxarifadosService.listar', () => {
  it('junta o nome da filial, e ordena pelo nome', async () => {
    const { service } = montar();
    const lista = await service.listar();
    expect(lista).toEqual([
      { id: 1, descricao: 'Estoque central', filialId: 1, filial: 'Matriz', ativo: true },
      { id: 2, descricao: 'Van do Anderson', filialId: 1, filial: 'Matriz', ativo: false },
    ]);
  });

  it('completa com quem só apareceu no saldo — o `almox` (listar) do IXC não devolve todos', async () => {
    const { service } = montar([
      { id: 2, nome: 'Van do Anderson' }, // já está no `almox`: não duplica.
      { id: 7, nome: 'Van do Matheus' }, // só no saldo: entra sem filial, ativo.
    ]);
    const lista = await service.listar();
    expect(lista).toHaveLength(3);
    expect(lista).toContainEqual({
      id: 7,
      descricao: 'Van do Matheus',
      filialId: 0,
      filial: null,
      ativo: true,
    });
  });

  it('não quebra se o saldo falhar — mostra ao menos o que o `almox` devolveu', async () => {
    const { service, estoque } = montar();
    estoque.almoxarifadosConhecidos.mockRejectedValue(new Error('IXC fora do ar'));
    const lista = await service.listar();
    expect(lista).toHaveLength(2);
  });
});

describe('AlmoxarifadosService.criar', () => {
  it('grava no IXC e relê o cadastro', async () => {
    const { service, ixc } = montar();
    // O terceiro almoxarifado ainda não está no mock de `listar` — troca por
    // um que inclua o #3 depois de "criado".
    ixc.listAll.mockImplementation(async (tabela: string) => {
      if (tabela === 'almox') {
        return [...ALMOX, { id: '3', descricao: 'Van nova', id_filial: '1', ativo: 'S' }];
      }
      if (tabela === 'filial') return FILIAIS;
      return [];
    });
    const criado = await service.criar({ descricao: 'Van nova', filialId: 1 }, eu);
    expect(ixc.create).toHaveBeenCalledWith(
      'almox',
      expect.objectContaining({ descricao: 'Van nova', id_filial: '1' }),
    );
    expect(criado.id).toBe(3);
  });
});

describe('AlmoxarifadosService.editar', () => {
  it('lê o registro e manda o cadastro inteiro de volta', async () => {
    const { service, ixc } = montar();
    await service.editar(2, { ativo: true }, eu);
    expect(ixc.getById).toHaveBeenCalledWith('almox', 'almox.id', 2);
    expect(ixc.update).toHaveBeenCalledWith(
      'almox',
      2,
      expect.objectContaining({ descricao: 'Van do Anderson', ativo: 'S' }),
    );
  });
});

describe('AlmoxarifadosService.apagar', () => {
  it('traduz a recusa do IXC em conselho de desativar', async () => {
    const { service, ixc } = montar();
    ixc.remove.mockRejectedValue(new Error('registro em uso'));
    await expect(service.apagar(2, eu)).rejects.toThrow(/desative-o/);
  });
});
