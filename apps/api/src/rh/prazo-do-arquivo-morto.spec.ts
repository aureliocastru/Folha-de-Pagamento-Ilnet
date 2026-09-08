import { DocumentosRhService, PASTA_DOS_SUBSTITUIDOS } from './documentos.service';

/**
 * O crachá de vencimento da pasta, e o papel que já foi trocado.
 *
 * Substituir uma certidão manda a velha para "Substituídos", com a validade que
 * ela tinha — que está no passado e vai continuar estando. Contada no crachá,
 * ela fazia o número subir a cada substituição e nunca mais descer: a pasta
 * cobrava justamente o que alguém já tinha resolvido.
 */
describe('o papel substituído não vence mais', () => {
  const ontem = new Date(Date.now() - 86_400_000);

  function montarServico(
    pastas: Array<{ id: string; nome: string; paiId: string | null }>,
    documentos: Array<{ pastaId: string; valeAte: Date | null }>,
  ) {
    const prisma = {
      pastaRh: {
        findMany: jest.fn(async () =>
          pastas.map((p) => ({
            ...p,
            daEmpresa: false,
            dosFuncionarios: false,
            funcionarioId: null,
            cpf: null,
            nomeManual: false,
            funcionario: null,
            _count: { subpastas: 0 },
          })),
        ),
        create: jest.fn(),
        createMany: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(async () => ({ id: 'gaveta' })),
      },
      documentoRh: {
        findMany: jest.fn(async () =>
          documentos.map((d) => ({ ...d, createdAt: new Date() })),
        ),
        groupBy: jest.fn(async () => []),
      },
      funcionario: { findMany: jest.fn(async () => []) },
    };
    return new DocumentosRhService(prisma as never, {} as never);
  }

  it('a certidão vencida na gaveta dos substituídos não entra no crachá', async () => {
    const service = montarServico(
      [
        { id: 'empresa', nome: 'M A CASTRO', paiId: null },
        { id: 'arquivo', nome: PASTA_DOS_SUBSTITUIDOS, paiId: 'empresa' },
      ],
      [
        // A que vale hoje, e venceu: esta o crachá tem de cobrar.
        { pastaId: 'empresa', valeAte: ontem },
        // Três trocadas ao longo do tempo, todas vencidas por definição.
        { pastaId: 'arquivo', valeAte: ontem },
        { pastaId: 'arquivo', valeAte: ontem },
        { pastaId: 'arquivo', valeAte: ontem },
      ],
    );

    const { pastas } = await service.pastas();
    const empresa = pastas.find((p) => p.id === 'empresa')!;
    const arquivo = pastas.find((p) => p.id === 'arquivo')!;

    // O crachá cobra uma só: a que está valendo.
    expect(empresa.naArvore.vencidos).toBe(1);
    expect(arquivo.vencidos).toBe(0);

    // Mas os quatro papéis continuam guardados, e o cartão diz isso.
    expect(empresa.naArvore.qtd).toBe(4);
    expect(arquivo.qtd).toBe(3);
  });
});
