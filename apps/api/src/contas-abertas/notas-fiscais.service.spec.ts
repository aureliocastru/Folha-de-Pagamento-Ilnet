import { NotasFiscaisService } from './notas-fiscais.service';
import { irmasNaCompra, type TituloParaAgrupar } from './parcelas.service';

/**
 * O número da nota fiscal escrito numa parcela vai para as outras da mesma
 * compra. O que este arquivo protege é o "da mesma compra": copiar para a
 * conta errada grava dado falso que vai para a contabilidade.
 */

function titulo(
  idFnApagar: number,
  extra: Partial<TituloParaAgrupar> = {},
): TituloParaAgrupar {
  return {
    idFnApagar,
    idFornecedor: 2877,
    valor: 500,
    vencimento: null,
    paga: false,
    marcacao: null,
    compra: '',
    ...extra,
  };
}

const parcela = (posicao: number, total = 3, compra = 'material para as máquinas') => ({
  marcacao: { posicao, total, fonte: 'observacao' as const },
  compra,
});

describe('irmasNaCompra', () => {
  it('acha as outras parcelas da mesma compra marcada "(n/m)"', () => {
    const titulos = [titulo(1, parcela(1)), titulo(2, parcela(2)), titulo(3, parcela(3))];

    expect(irmasNaCompra(titulos, 2).sort()).toEqual([1, 3]);
  });

  it('outra compra da mesma loja, com outra descrição, fica de fora', () => {
    const titulos = [
      titulo(1, parcela(1)),
      titulo(2, parcela(2)),
      titulo(9, parcela(1, 3, 'pneus da hilux')),
    ];

    expect(irmasNaCompra(titulos, 1)).toEqual([2]);
  });

  it('mesmo fornecedor e mesmo valor sem marca não é parcela: o aluguel de todo mês tem nota própria', () => {
    const titulos = [titulo(1), titulo(2), titulo(3)];

    expect(irmasNaCompra(titulos, 1)).toEqual([]);
  });

  it('posição repetida denuncia duas compras juntas, e aí não copia nada', () => {
    const titulos = [titulo(1, parcela(1)), titulo(2, parcela(2)), titulo(5, parcela(2))];

    expect(irmasNaCompra(titulos, 1)).toEqual([]);
  });

  it('outro fornecedor não entra, mesmo com a mesma descrição', () => {
    const titulos = [titulo(1, parcela(1)), titulo(2, { ...parcela(2), idFornecedor: 99 })];

    expect(irmasNaCompra(titulos, 1)).toEqual([]);
  });
});

function montar(opts: { gravados?: Record<number, string>; irmas?: number[] } = {}) {
  const banco = new Map<number, string>(
    Object.entries(opts.gravados ?? {}).map(([k, v]) => [Number(k), v]),
  );
  const prisma = {
    notaFiscalDoTitulo: {
      findUnique: jest.fn(async ({ where }: { where: { idFnApagar: number } }) =>
        banco.has(where.idFnApagar) ? { numero: banco.get(where.idFnApagar) } : null,
      ),
      findMany: jest.fn(async ({ where }: { where: { idFnApagar: { in: number[] } } }) =>
        where.idFnApagar.in
          .filter((id) => banco.has(id))
          .map((id) => ({ idFnApagar: id, numero: banco.get(id) })),
      ),
      upsert: jest.fn(
        async ({ where, update }: { where: { idFnApagar: number }; update: { numero: string } }) => {
          banco.set(where.idFnApagar, update.numero);
        },
      ),
      deleteMany: jest.fn(async ({ where }: { where: { idFnApagar: number } }) => {
        banco.delete(where.idFnApagar);
      }),
    },
  };
  const parcelas = { irmasDe: jest.fn().mockResolvedValue(opts.irmas ?? []) };
  const service = new NotasFiscaisService(prisma as never, parcelas as never);
  return { service, banco, parcelas };
}

describe('NotasFiscaisService.definir', () => {
  it('grava no título e nas parcelas irmãs que ainda não tinham número', async () => {
    const { service, banco } = montar({ irmas: [11, 12] });

    const r = await service.definir(10, ' 4521 ', 'adm');

    expect(r).toEqual({ numero: '4521', parcelas: 2 });
    expect([...banco.entries()].sort()).toEqual([
      [10, '4521'],
      [11, '4521'],
      [12, '4521'],
    ]);
  });

  it('parcela irmã que já tem outra nota não é sobrescrita', async () => {
    const { service, banco } = montar({ irmas: [11, 12], gravados: { 12: '999' } });

    const r = await service.definir(10, '4521');

    expect(r.parcelas).toBe(1);
    expect(banco.get(12)).toBe('999');
  });

  it('corrigir o número corrige as irmãs que tinham o número antigo', async () => {
    const { service, banco } = montar({
      irmas: [11],
      gravados: { 10: '452', 11: '452' },
    });

    await service.definir(10, '4521');

    expect(banco.get(11)).toBe('4521');
  });

  it('vazio apaga, aqui e nas irmãs que tinham o mesmo', async () => {
    const { service, banco } = montar({ irmas: [11], gravados: { 10: '452', 11: '452' } });

    await service.definir(10, '');

    expect(banco.size).toBe(0);
  });

  it('o mesmo número de antes não vai ao IXC atrás de irmãs', async () => {
    const { service, parcelas } = montar({ gravados: { 10: '4521' } });

    await service.definir(10, '4521');

    expect(parcelas.irmasDe).not.toHaveBeenCalled();
  });

  it('IXC fora do ar: o número do título fica, as irmãs esperam', async () => {
    const { service, banco, parcelas } = montar();
    parcelas.irmasDe.mockRejectedValue(new Error('timeout'));

    const r = await service.definir(10, '4521');

    expect(r).toEqual({ numero: '4521', parcelas: 0 });
    expect(banco.get(10)).toBe('4521');
  });
});

describe('NotasFiscaisService.noLancamento', () => {
  it('todas as parcelas lançadas ganham o número, apontando para a primeira', async () => {
    const { service, banco } = montar();

    await service.noLancamento([30, 31, null, 32], '777');

    expect([...banco.keys()].sort()).toEqual([30, 31, 32]);
  });

  it('sem número não grava nada', async () => {
    const { service, banco } = montar();

    await service.noLancamento([30, 31], '  ');

    expect(banco.size).toBe(0);
  });
});
