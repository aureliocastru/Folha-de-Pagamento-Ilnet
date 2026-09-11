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

// Existe no IXC (acha pelo `getById`), mas o `almox` (listar) não o devolve —
// é o caso que a listagem trunca.
const VAN_DO_MATHEUS = { id: '7', descricao: 'Van do Matheus', id_filial: '1', ativo: 'S' };

const FILIAIS = [{ id: '1', filial: 'Matriz' }];

function montar(doSaldo: Array<{ id: number; nome: string }> = []) {
  const porId = new Map([
    ['1', ALMOX[0]],
    ['2', ALMOX[1]],
    ['7', VAN_DO_MATHEUS],
  ]);
  const ixc = {
    listAll: jest.fn(async (tabela: string) => {
      if (tabela === 'almox') return ALMOX;
      if (tabela === 'filial') return FILIAIS;
      return [];
    }),
    // Uma consulta por id, de verdade — devolve null para quem não existe,
    // como o `id: 99` usado no teste do "genuinamente não achado".
    getById: jest.fn(async (_tabela: string, _campo: string, id: number | string) =>
      porId.get(String(id)) ?? null,
    ),
    create: jest.fn(async () => ({ id: 3, raw: {} })),
    update: jest.fn(async () => ({ type: 'success' })),
    remove: jest.fn(async () => ({ type: 'success' })),
  };
  const estoque = { almoxarifadosConhecidos: jest.fn(async () => doSaldo) };
  const service = new AlmoxarifadosService(ixc as never, estoque as never);
  return { service, ixc, estoque, porId };
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

  it('completa com quem só apareceu no saldo, buscando o cadastro real pelo id', async () => {
    const { service } = montar([
      { id: 2, nome: 'Van do Anderson' }, // já está no `almox`: não duplica.
      { id: 7, nome: 'Van do Matheus' }, // fora da listagem, mas existe — o getById acha.
    ]);
    const lista = await service.listar();
    expect(lista).toHaveLength(3);
    // Achou de verdade: filial e ativo do cadastro, não o palpite.
    expect(lista).toContainEqual({
      id: 7,
      descricao: 'Van do Matheus',
      filialId: 1,
      filial: 'Matriz',
      ativo: true,
    });
  });

  it('quando nem o getById acha, entra com o aviso "não achado no cadastro"', async () => {
    const { service } = montar([{ id: 99, nome: 'Nome velho do saldo' }]);
    const lista = await service.listar();
    expect(lista).toContainEqual({
      id: 99,
      descricao: 'Nome velho do saldo',
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
  it('grava no IXC e relê o cadastro pelo id — sem depender da listagem', async () => {
    const { service, ixc, porId } = montar();
    // Recém-criado: não tem saldo ainda, e pode nem caber na listagem
    // truncada — por isso `criar` não pode depender de `listar()` para
    // confirmar. Só o `getById` sabe dele.
    porId.set('3', { id: '3', descricao: 'Van nova', id_filial: '1', ativo: 'S' });
    const criado = await service.criar({ descricao: 'Van nova', filialId: 1 }, eu);
    expect(ixc.create).toHaveBeenCalledWith(
      'almox',
      expect.objectContaining({ descricao: 'Van nova', id_filial: '1' }),
    );
    expect(criado).toEqual({
      id: 3,
      descricao: 'Van nova',
      filialId: 1,
      filial: 'Matriz',
      ativo: true,
    });
  });

  it('recusa quando o IXC não devolve o cadastro nem pelo id', async () => {
    const { service, ixc } = montar();
    ixc.create.mockResolvedValue({ id: 999, raw: {} });
    await expect(service.criar({ descricao: 'Sumiu', filialId: 1 }, eu)).rejects.toThrow(
      /não apareceu no IXC/,
    );
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
