import { NotFoundException } from '@nestjs/common';
import { AprService } from './apr.service';

/**
 * Quem aparece para ser escolhido como executante (pedido de 26/11/2026).
 *
 * A Segurança do Trabalho tira da lista quem tem login mas não vai ao serviço
 * — o escritório, a diretoria. Some de "Adicionar executante" e, por isso,
 * não entra sozinho na equipe da APR que abre. Na tela dela, continua
 * aparecendo, marcado, para poder voltar.
 */

const PESSOAS = [
  { id: 'f1', nome: 'Cleyson Rodrigues', apelido: null, cpfCnpj: '1', funcao: 'Técnico', foraDasAprs: false },
  { id: 'f2', nome: 'Ana Paula Moura', apelido: null, cpfCnpj: '2', funcao: 'Financeiro', foraDasAprs: true },
  { id: 'f3', nome: 'Jonas Batista', apelido: null, cpfCnpj: '3', funcao: 'Técnico', foraDasAprs: false },
];

// Jonas não tem login: não aparece em lista nenhuma.
const LOGINS = [
  { nome: 'Cleyson', email: 'cleyson@ilnet.net.br', funcionarioId: 'f1' },
  { nome: 'Ana', email: 'ana@ilnet.net.br', funcionarioId: 'f2' },
];

function montar() {
  const pessoas = PESSOAS.map((p) => ({ ...p }));
  const prisma = {
    funcionario: {
      findMany: jest.fn(async () => pessoas),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        pessoas.find((p) => p.id === where.id) ?? null,
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: { foraDasAprs: boolean } }) => {
          const p = pessoas.find((x) => x.id === where.id)!;
          p.foraDasAprs = data.foraDasAprs;
          return p;
        },
      ),
    },
    user: { findMany: jest.fn(async () => LOGINS) },
  };
  const service = new AprService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}

describe('a lista de executantes', () => {
  it('quem foi tirado não aparece para escolher', async () => {
    const { service } = montar();
    const equipe = await service.equipe();
    expect(equipe.map((p) => p.id)).toEqual(['f1']);
    // A lista do técnico não diz quem foi tirado: só não o mostra.
    expect(equipe[0]).not.toHaveProperty('foraDasAprs');
  });

  it('na tela da Segurança do Trabalho, quem foi tirado continua, marcado', async () => {
    const { service } = montar();
    expect(await service.quemPodeExecutar()).toEqual([
      expect.objectContaining({ id: 'f1', foraDasAprs: false }),
      expect.objectContaining({ id: 'f2', foraDasAprs: true }),
    ]);
  });

  it('tirar e devolver muda a lista na hora', async () => {
    const { service } = montar();
    await service.marcarForaDasAprs('f1', true);
    expect(await service.equipe()).toEqual([]);

    const devolvida = await service.marcarForaDasAprs('f2', false);
    expect(devolvida).toMatchObject({ id: 'f2', foraDasAprs: false });
    expect((await service.equipe()).map((p) => p.id)).toEqual(['f2']);
  });

  it('funcionário que não existe não é marcado', async () => {
    const { service, prisma } = montar();
    await expect(service.marcarForaDasAprs('nao-existe', true)).rejects.toThrow(NotFoundException);
    expect(prisma.funcionario.update).not.toHaveBeenCalled();
  });
});
