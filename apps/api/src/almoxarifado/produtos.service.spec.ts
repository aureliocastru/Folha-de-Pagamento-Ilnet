import { ProdutosService } from './produtos.service';

/**
 * O serviço que escreve os produtos no IXC. O que se protege aqui:
 *
 *  - toda escrita lê o produto antes, e a edição manda o cadastro inteiro;
 *  - não se apaga produto com saldo, e a recusa do IXC vira o conselho de
 *    desativar;
 *  - não se transfere mais do que a origem tem;
 *  - a transferência e a entrada conferem o saldo no IXC depois, e a tela
 *    fica sabendo se ele mudou ou não.
 */

const PRODUTO = {
  id: '36',
  descricao: 'Conector APC',
  ativo: 'S',
  unidade: '1',
  tipo: 'C',
  preco_base: '1.50',
  ncm: '85367000',
  id_sub_grupo: '1',
  movimentacao: 'A',
  icms_issqn: 'I',
  id_class_fiscal: '2',
};

const ALMOX = [
  { id: '1', descricao: 'Estoque central', id_filial: '1', ativo: 'S' },
  { id: '2', descricao: 'Van do Anderson', id_filial: '1', ativo: 'S' },
];

function saldoLinha(almox: string, saldo: number) {
  return {
    id_produto: '36',
    produto_descricao: 'Conector APC',
    id_almox: almox,
    almox_descricao: ALMOX.find((a) => a.id === almox)?.descricao,
    saldo: String(saldo),
  };
}

function montar(opts: { saldos?: Array<[string, number]>; saldosDepois?: Array<[string, number]> } = {}) {
  // O saldo "de depois" vale a partir da primeira escrita no IXC.
  let escreveu = false;
  const ixc = {
    getById: jest.fn(async () => PRODUTO),
    list: jest.fn(async () => ({ total: 0, page: 1, registros: [] })),
    update: jest.fn(async () => ({ type: 'success' })),
    remove: jest.fn(async () => ({ type: 'success' })),
    create: jest.fn(async (tabela: string) => {
      escreveu = true;
      return { id: tabela === 'produtos' ? 99 : 5, raw: {} };
    }),
    listAll: jest.fn(async (tabela: string): Promise<Array<Record<string, string | undefined>>> => {
      if (tabela === 'unidades') return [{ id: '1', sigla: 'UN', descricao: 'Unidade' }];
      if (tabela === 'almox') return ALMOX;
      if (tabela === 'estoque_produtos_almox_filial') {
        const fonte = escreveu && opts.saldosDepois ? opts.saldosDepois : (opts.saldos ?? []);
        return fonte.map(([a, s]) => saldoLinha(a, s));
      }
      return [];
    }),
  };
  const estoque = {
    esquecer: jest.fn(),
    saldosDoProduto: jest.fn(async () => {
      const linhas = await ixc.listAll('estoque_produtos_almox_filial');
      if (linhas.length === 0) return null;
      const saldos = linhas.map((l) => ({
        almoxId: Number(l.id_almox),
        almoxarifado: String(l.almox_descricao),
        saldo: Number(l.saldo),
        minimo: null,
        maximo: null,
        abaixoDoMinimo: false,
      }));
      return { saldos, total: saldos.reduce((s, x) => s + x.saldo, 0) };
    }),
  };
  const service = new ProdutosService(ixc as never, estoque as never, {} as never);
  return { service, ixc, estoque };
}

const eu = { nome: 'Administrador' };

describe('ProdutosService.editar', () => {
  it('lê o produto e manda o cadastro inteiro de volta', async () => {
    const { service, ixc, estoque } = montar();
    await service.editar(36, { precoBase: 2 }, eu);
    expect(ixc.getById).toHaveBeenCalledWith('produtos', 'produtos.id', 36);
    expect(ixc.update).toHaveBeenCalledWith(
      'produtos',
      36,
      expect.objectContaining({ ncm: '85367000', descricao: 'Conector APC', preco_base: '2.00' }),
    );
    expect(estoque.esquecer).toHaveBeenCalled();
  });

  it('recusa nome que já existe em outro produto', async () => {
    const { service, ixc } = montar();
    ixc.list.mockResolvedValueOnce({
      total: 1,
      page: 1,
      registros: [{ id: '40', descricao: 'Conector SC' }] as never[],
    });
    await expect(service.editar(36, { descricao: 'conector sc' }, eu)).rejects.toThrow(
      /Já existe um produto "Conector SC"/,
    );
    expect(ixc.update).not.toHaveBeenCalled();
  });

  // O modelo padrão: completo, e produto comum de estoque (ver `validarModelo`).
  const BATERIA = {
    id: '612',
    descricao: 'BATERIA APC',
    tipo: 'C',
    id_sub_grupo: '4',
    movimentacao: 'A',
    icms_issqn: 'I',
    id_class_fiscal: '9',
    ncm: '85072010',
  };

  it('produto sem NCM: o fiscal que falta vem do modelo padrão, sem ninguém escolher', async () => {
    const { service, ixc } = montar();
    const semNcm = { ...PRODUTO, ncm: '' };
    ixc.getById.mockImplementation((async (_t: string, _c: string, id: number) =>
      id === 612 ? BATERIA : semNcm) as never);
    await service.editar(36, { ativo: false }, eu);
    expect(ixc.getById).toHaveBeenCalledWith('produtos', 'produtos.id', 612);
    expect(ixc.update).toHaveBeenCalledWith(
      'produtos',
      36,
      expect.objectContaining({ ncm: '85072010', ativo: 'N', descricao: 'Conector APC' }),
    );
  });

  it('produto com o fiscal completo não lê modelo nenhum', async () => {
    const { service, ixc } = montar();
    await service.editar(36, { precoBase: 2 }, eu);
    expect(ixc.getById).not.toHaveBeenCalledWith('produtos', 'produtos.id', 612);
    expect(ixc.update).toHaveBeenCalledWith('produtos', 36, expect.objectContaining({ ncm: '85367000' }));
  });

  it('cadastro novo sem modelo escolhido usa o padrão', async () => {
    const { service, ixc } = montar();
    ixc.getById.mockImplementation((async (_t: string, _c: string, id: number) =>
      id === 612 ? BATERIA : PRODUTO) as never);
    await service.criar({ descricao: 'Lixa ferro 100', precoBase: 1.5, unidadeId: 1 }, eu);
    expect(ixc.create).toHaveBeenCalledWith('produtos', expect.objectContaining({ ncm: '85072010' }));
  });
});

describe('ProdutosService.apagar', () => {
  it('recusa produto com saldo', async () => {
    const { service, ixc } = montar({ saldos: [['1', 3]] });
    await expect(service.apagar(36, eu)).rejects.toThrow(/ainda tem saldo em Estoque central \(3\)/);
    expect(ixc.remove).not.toHaveBeenCalled();
  });

  it('a recusa do IXC vira o conselho de desativar', async () => {
    const { service, ixc } = montar({ saldos: [['1', 0]] });
    ixc.remove.mockRejectedValueOnce(new Error('registro em uso'));
    await expect(service.apagar(36, eu)).rejects.toThrow(/desative-o em vez de apagar/);
  });
});

describe('ProdutosService.transferir', () => {
  it('não transfere mais do que a origem tem', async () => {
    const { service, ixc } = montar({ saldos: [['1', 2]] });
    await expect(
      service.transferir(36, { de: 1, para: 2, quantidade: 5 }, eu),
    ).rejects.toThrow(/tem 2 de "Conector APC"/);
    expect(ixc.create).not.toHaveBeenCalled();
  });

  it('abre a transferência, inclui o item e confere os dois saldos', async () => {
    const { service, ixc } = montar({
      saldos: [['1', 10], ['2', 1]],
      saldosDepois: [['1', 7], ['2', 4]],
    });
    const r = await service.transferir(36, { de: 1, para: 2, quantidade: 3 }, eu);
    expect(ixc.create).toHaveBeenNthCalledWith(
      1,
      'transf_almox_top',
      expect.objectContaining({ id_almox_saida: '1', id_almox_entrada: '2', id_filial: '1' }),
    );
    expect(ixc.create).toHaveBeenNthCalledWith(
      2,
      'transf_almox_item',
      expect.objectContaining({ id_produto: '36', qtde: '3.00000', id_transf_almox: '5', unidade_sigla: 'UN' }),
    );
    expect(r.origem).toEqual({ antes: 10, depois: 7, confere: true });
    expect(r.destino).toEqual({ antes: 1, depois: 4, confere: true });
  });
});

describe('ProdutosService.darEntrada', () => {
  const entrada = {
    almoxId: 1,
    quantidade: 5,
    valorUnitario: 2,
    fornecedorId: 7,
    tipoDocumentoId: 201,
    condicaoPagamentoId: 1,
  };

  it('lança a compra aberta e o item, e diz se o saldo subiu', async () => {
    const { service, ixc } = montar({ saldos: [['1', 10]], saldosDepois: [['1', 15]] });
    const r = await service.darEntrada(36, entrada, eu);
    expect(ixc.create).toHaveBeenNthCalledWith(
      1,
      'entrada',
      expect.objectContaining({ status: 'A', id_fornecedor: '7', valor_total: '10,00' }),
    );
    expect(ixc.create).toHaveBeenNthCalledWith(
      2,
      'movimento_produtos',
      expect.objectContaining({ tipo: 'E', estoque: 'S', id_entrada: '5', quantidade: '5.00000' }),
    );
    expect(r.conferencia).toEqual({ antes: 10, depois: 15, confere: true });
  });

  it('se o IXC só soma ao finalizar, a conferência diz que não subiu', async () => {
    const { service } = montar({ saldos: [['1', 10]], saldosDepois: [['1', 10]] });
    const r = await service.darEntrada(36, entrada, eu);
    expect(r.conferencia.confere).toBe(false);
  });

  it('se o item falha, diz o número da compra aberta', async () => {
    const { service, ixc } = montar({ saldos: [['1', 10]] });
    ixc.create
      .mockResolvedValueOnce({ id: 12, raw: {} })
      .mockRejectedValueOnce(new Error('campo obrigatório'));
    await expect(service.darEntrada(36, entrada, eu)).rejects.toThrow(/compra #12 foi aberta/);
  });

  it('se o IXC recusa abrir a compra, aponta o tipo de documento e não manda o item', async () => {
    const { service, ixc } = montar({ saldos: [['1', 10]] });
    ixc.create.mockRejectedValueOnce(new Error('Ocorreu um erro ao processar. Contate o suporte IXC Soft.'));
    await expect(service.darEntrada(36, { ...entrada, tipoDocumentoId: 35 }, eu)).rejects.toThrow(
      /tipo de documento 35/,
    );
    expect(ixc.create).toHaveBeenCalledTimes(1);
  });

  /** As compras recentes do IXC, e a compra relida depois de fechar. */
  function comComprasNoIxc(
    ixc: ReturnType<typeof montar>['ixc'],
    statusDepois: string,
  ) {
    ixc.list.mockImplementation((async (tabela: string) =>
      tabela === 'entrada'
        ? {
            total: 5,
            page: 1,
            registros: [{ status: 'A' }, { status: 'F' }, { status: 'F' }, { status: 'C' }, { status: 'F' }],
          }
        : { total: 0, page: 1, registros: [] }) as never);
    ixc.getById.mockImplementation((async (tabela: string) =>
      tabela === 'entrada' ? { id: '5', status: statusDepois } : PRODUTO) as never);
  }

  it('fecha a compra com o status que as compras fechadas do IXC têm, e relê', async () => {
    const { service, ixc } = montar({ saldos: [['1', 10]], saldosDepois: [['1', 15]] });
    comComprasNoIxc(ixc, 'F');
    const r = await service.darEntrada(36, entrada, eu);
    // A compra inteira de novo, com o dinheiro em vírgula — só o status muda.
    expect(ixc.update).toHaveBeenCalledWith(
      'entrada',
      5,
      expect.objectContaining({ status: 'F', id_fornecedor: '7', valor_total: '10,00', gera_estoque: 'S' }),
    );
    expect(r.compraAberta).toBeNull();
  });

  it('se o IXC não fecha, a entrada vale e a tela recebe o motivo', async () => {
    const { service, ixc } = montar({ saldos: [['1', 10]], saldosDepois: [['1', 15]] });
    comComprasNoIxc(ixc, 'F');
    ixc.update.mockRejectedValueOnce(new Error('compra sem financeiro'));
    const r = await service.darEntrada(36, entrada, eu);
    expect(r.entradaId).toBe(5);
    expect(r.compraAberta).toMatch(/recusou fechar.*compra sem financeiro/);
  });

  it('se o IXC aceita mas a compra continua aberta, não diz que fechou', async () => {
    const { service, ixc } = montar({ saldos: [['1', 10]], saldosDepois: [['1', 15]] });
    comComprasNoIxc(ixc, 'A');
    const r = await service.darEntrada(36, entrada, eu);
    expect(r.compraAberta).toMatch(/continua com status "A"/);
  });

  it('sem compra fechada no IXC para copiar, não inventa o status', async () => {
    const { service, ixc } = montar({ saldos: [['1', 10]], saldosDepois: [['1', 15]] });
    const r = await service.darEntrada(36, entrada, eu);
    expect(ixc.update).not.toHaveBeenCalledWith('entrada', expect.anything(), expect.anything());
    expect(r.compraAberta).toMatch(/não achei/);
  });
});
