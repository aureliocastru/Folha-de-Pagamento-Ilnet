import {
  EdicaoNasParcelasService,
  observacaoDaIrma,
  vencimentoDaIrma,
} from './edicao-nas-parcelas.service';

/**
 * Editar uma parcela e levar a mudança às outras da compra. O que este arquivo
 * protege: cada irmã continua sendo a parcela que era — a marca "(3/10)" dela,
 * o mês dela, o boleto dela —, e a paga não é tocada.
 */

describe('a descrição nas irmãs', () => {
  it('troca o texto e mantém a marca de cada parcela', () => {
    expect(observacaoDaIrma('Switches de rede (1/10)', 'Equipamentos (3/10)')).toBe(
      'Switches de rede (3/10)',
    );
  });

  it('texto novo sem marca ganha a da irmã', () => {
    expect(observacaoDaIrma('Switches', 'Equipamentos (3/10)')).toBe('Switches (3/10)');
  });

  it('irmã sem marca na descrição (marcada no número da nota) fica só com o texto', () => {
    expect(observacaoDaIrma('Switches (1/10)', 'Equipamentos')).toBe('Switches');
  });
});

describe('o vencimento nas irmãs', () => {
  it('a mensal vai para o dia novo, no mês dela andado o mesmo tanto', () => {
    expect(vencimentoDaIrma('2026-10-29', '2026-11-05', '2026-12-29')).toBe('2027-01-05');
  });

  it('só o dia mudou: todas passam a vencer nele', () => {
    expect(vencimentoDaIrma('2026-10-29', '2026-10-10', '2027-03-29')).toBe('2027-03-10');
  });

  it('dia que não existe no mês da irmã cai no último dia dele', () => {
    expect(vencimentoDaIrma('2026-10-15', '2026-10-31', '2027-02-15')).toBe('2027-02-28');
  });

  it('a de outro dia (quinzenal) anda os mesmos dias', () => {
    expect(vencimentoDaIrma('2026-10-01', '2026-10-03', '2026-10-16')).toBe('2026-10-18');
  });
});

describe('levar a edição às irmãs', () => {
  function montar(opts: { falhaEm?: number } = {}) {
    const titulos: Record<number, Record<string, unknown>> = {
      100: { id: '100', data_vencimento: '2026-10-29', obs: 'Equipamentos (1/3)' },
      101: { id: '101', data_vencimento: '2026-11-29', obs: 'Equipamentos (2/3)' },
      102: { id: '102', data_vencimento: '2026-12-29', obs: 'Equipamentos (3/3)' },
    };
    const ixc = {
      getById: jest.fn(async (_t: string, _c: string, id: number) => titulos[id] ?? null),
    };
    const editar = jest.fn(async (id: number) => {
      if (id === opts.falhaEm) throw new Error('O IXC recusou');
      return { idFnApagar: id, alterado: [], reaprovada: false };
    });
    const parcelas = {
      irmasComSituacao: jest.fn(async () => [
        { idFnApagar: 99, paga: true },
        { idFnApagar: 101, paga: false },
        { idFnApagar: 102, paga: false },
      ]),
    };
    const service = new EdicaoNasParcelasService(
      ixc as never,
      { editar } as never,
      parcelas as never,
    );
    return { service, editar };
  }

  it('edita a parcela e as irmãs em aberto; a paga fica como está', async () => {
    const { service, editar } = montar();

    const r = await service.editar(100, { contaPagamento: 18, observacao: 'Switches (1/3)' });

    expect(editar).toHaveBeenCalledWith(100, { contaPagamento: 18, observacao: 'Switches (1/3)' });
    expect(editar).toHaveBeenCalledWith(101, { contaPagamento: 18, observacao: 'Switches (2/3)' });
    expect(editar).toHaveBeenCalledWith(102, { contaPagamento: 18, observacao: 'Switches (3/3)' });
    expect(editar).not.toHaveBeenCalledWith(99, expect.anything());
    expect(r.parcelas).toEqual({ atualizadas: [101, 102], falhas: [] });
  });

  it('o vencimento anda em cada irmã a partir do dela', async () => {
    const { service, editar } = montar();

    await service.editar(100, { dataVencimento: '2026-11-05' });

    expect(editar).toHaveBeenCalledWith(101, { dataVencimento: '2026-12-05' });
    expect(editar).toHaveBeenCalledWith(102, { dataVencimento: '2027-01-05' });
  });

  it('o boleto é de cada uma: não vai às irmãs', async () => {
    const { service, editar } = montar();

    const r = await service.editar(100, { codigoBarras: '23790000000000000000000000000000000000000000' });

    expect(editar).toHaveBeenCalledTimes(1);
    expect(r.parcelas.atualizadas).toEqual([]);
  });

  it('uma irmã que falha não desfaz as outras, e é contada', async () => {
    const { service } = montar({ falhaEm: 101 });

    const r = await service.editar(100, { valor: 900 });

    expect(r.parcelas).toEqual({
      atualizadas: [102],
      falhas: [{ idFnApagar: 101, erro: 'O IXC recusou' }],
    });
  });
});
