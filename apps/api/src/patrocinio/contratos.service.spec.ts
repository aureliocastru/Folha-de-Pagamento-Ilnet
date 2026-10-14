import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { ModoAssinatura, OrigemDoContrato, Prisma } from '@prisma/client';
import { CONTRATO_PADRAO } from './contrato.texto';
import { ContratosDePatrocinioService, VALIDADE_DO_LINK_DIAS } from './contratos.service';

/**
 * O que este arquivo protege: o contrato que o patrocinado assina é o texto
 * que ele leu. Ele não muda depois de assinado, não é assinado duas vezes, não
 * se apaga depois de assinado, e o link que leva a ele não vive para sempre.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 teste').toString('base64')}`;

const PATROCINADO = {
  id: 'p1',
  nome: 'Futsal Unidos',
  projeto: 'Time de futsal sub-17',
  cpfCnpj: '12.345.678/0001-00',
  responsavel: 'Carlos Técnico',
  valorMensal: new Prisma.Decimal(500),
  inicio: new Date('2026-10-01T00:00:00Z'),
  fim: new Date('2027-09-30T00:00:00Z'),
};

const CFG = { empresaNome: 'ILNET', empresaCnpj: '11.111.111/0001-11' };

function contratoGravado(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    patrocinadoId: 'p1',
    origem: OrigemDoContrato.LINK,
    token: 'tok',
    expiraEm: new Date(Date.now() + 86_400_000),
    texto: CONTRATO_PADRAO,
    nomePatrocinado: 'Futsal Unidos',
    cpfPatrocinado: '12.345.678/0001-00',
    projeto: 'Time de futsal sub-17',
    valorMensal: new Prisma.Decimal(500),
    inicio: PATROCINADO.inicio,
    fim: PATROCINADO.fim,
    empresaNome: 'ILNET',
    empresaCnpj: '11.111.111/0001-11',
    assinaturaPng: null,
    modo: ModoAssinatura.DESENHADA,
    nomeAssinante: null,
    ip: null,
    userAgent: null,
    assinadoEm: null,
    arquivoNome: null,
    arquivoTipo: null,
    arquivoTamanho: null,
    arquivo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    patrocinado: { nome: 'Futsal Unidos', responsavel: 'Carlos Técnico' },
    ...over,
  };
}

function montar(
  opts: {
    patrocinado?: Record<string, unknown> | null;
    abertos?: Array<{ id: string }>;
    contrato?: Record<string, unknown> | null;
    assinou?: number;
  } = {},
) {
  const prisma = {
    patrocinado: {
      findUnique: jest.fn().mockResolvedValue(
        opts.patrocinado === undefined
          ? { ...PATROCINADO, contratos: opts.abertos ?? [] }
          : opts.patrocinado,
      ),
    },
    contratoDePatrocinio: {
      findUnique: jest.fn().mockResolvedValue(opts.contrato === undefined ? contratoGravado() : opts.contrato),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'novo', ...data })),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: where.id,
        ...data,
      })),
      updateMany: jest.fn().mockResolvedValue({ count: opts.assinou ?? 1 }),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  const config = { obter: jest.fn().mockResolvedValue(CFG) };
  const service = new ContratosDePatrocinioService(prisma as never, config as never);
  return { service, prisma };
}

describe('ContratosDePatrocinioService — o link', () => {
  it('congela o texto padrão e os dados do cadastro, e vence em 15 dias', async () => {
    const { service, prisma } = montar();
    const antes = Date.now();
    await service.gerarLink('p1', 'u1');

    const { data } = prisma.contratoDePatrocinio.create.mock.calls[0][0];
    expect(data).toMatchObject({
      patrocinadoId: 'p1',
      origem: OrigemDoContrato.LINK,
      texto: CONTRATO_PADRAO,
      nomePatrocinado: 'Futsal Unidos',
      projeto: 'Time de futsal sub-17',
      empresaNome: 'ILNET',
      empresaCnpj: '11.111.111/0001-11',
      criadoPor: 'u1',
    });
    expect(data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const prazo = (data.expiraEm as Date).getTime() - antes;
    expect(Math.round(prazo / 86_400_000)).toBe(VALIDADE_DO_LINK_DIAS);
  });

  it('com um link aberto, renova o mesmo em vez de abrir uma segunda via', async () => {
    const { service, prisma } = montar({ abertos: [{ id: 'c-aberto' }] });
    await service.gerarLink('p1');
    expect(prisma.contratoDePatrocinio.create).not.toHaveBeenCalled();
    expect(prisma.contratoDePatrocinio.update.mock.calls[0][0].where).toEqual({ id: 'c-aberto' });
  });

  it('patrocinado que não existe', async () => {
    const { service } = montar({ patrocinado: null });
    await expect(service.gerarLink('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ContratosDePatrocinioService — de quem assina', () => {
  it('abre o contrato com o texto congelado e sugere o responsável para assinar', async () => {
    const { service } = montar();
    const c = await service.abrirPorToken('tok');
    expect(c.texto).toBe(CONTRATO_PADRAO);
    expect(c.quemAssina).toBe('Carlos Técnico');
    expect(c.valorMensal).toBe('500');
    expect(c.assinado).toBe(false);
  });

  it('link vencido e não assinado não abre', async () => {
    const { service } = montar({ contrato: contratoGravado({ expiraEm: new Date(Date.now() - 1000) }) });
    await expect(service.abrirPorToken('tok')).rejects.toBeInstanceOf(GoneException);
  });

  it('assinado abre como comprovante, mesmo depois do prazo', async () => {
    const { service } = montar({
      contrato: contratoGravado({
        expiraEm: new Date(Date.now() - 1000),
        assinadoEm: new Date(),
        assinaturaPng: PNG,
      }),
    });
    await expect(service.abrirPorToken('tok')).resolves.toMatchObject({ assinado: true });
  });

  it('o token de um escaneado não existe para a tela pública', async () => {
    const { service } = montar({ contrato: contratoGravado({ origem: OrigemDoContrato.ESCANEADO }) });
    await expect(service.abrirPorToken('tok')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('grava só se ainda estiver sem assinatura e com o mesmo token', async () => {
    const { service, prisma } = montar();
    await service.assinar('tok', { assinatura: PNG, nome: 'Carlos Alberto' }, { ip: '1.2.3.4', userAgent: 'x' });

    const chamada = prisma.contratoDePatrocinio.updateMany.mock.calls[0][0];
    expect(chamada.where).toEqual({ id: 'c1', token: 'tok', assinadoEm: null });
    expect(chamada.data).toMatchObject({
      assinaturaPng: PNG,
      nomeAssinante: 'Carlos Alberto',
      modo: ModoAssinatura.DESENHADA,
      ip: '1.2.3.4',
    });
  });

  it('sem nome digitado, assina o responsável', async () => {
    const { service, prisma } = montar();
    await service.assinar('tok', { assinatura: PNG }, {});
    expect(prisma.contratoDePatrocinio.updateMany.mock.calls[0][0].data.nomeAssinante).toBe('Carlos Técnico');
  });

  it('dois toques, ou o link trocado no meio: a segunda gravação não acontece', async () => {
    const { service } = montar({ assinou: 0 });
    await expect(service.assinar('tok', { assinatura: PNG }, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('já assinado não assina de novo', async () => {
    const { service, prisma } = montar({ contrato: contratoGravado({ assinadoEm: new Date() }) });
    await expect(service.assinar('tok', { assinatura: PNG }, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.contratoDePatrocinio.updateMany).not.toHaveBeenCalled();
  });
});

describe('ContratosDePatrocinioService — escaneado e remoção', () => {
  it('guarda o PDF do contrato físico, já valendo, com a data do papel', async () => {
    const { service, prisma } = montar({ patrocinado: PATROCINADO });
    await service.guardarEscaneado('p1', { arquivo: PDF, arquivoNome: 'contrato.pdf', assinadoEm: '2025-03-10' });

    const { data } = prisma.contratoDePatrocinio.create.mock.calls[0][0];
    expect(data).toMatchObject({
      origem: OrigemDoContrato.ESCANEADO,
      arquivoTipo: 'application/pdf',
      arquivoNome: 'contrato.pdf',
    });
    expect((data.assinadoEm as Date).toISOString().slice(0, 10)).toBe('2025-03-10');
  });

  it('o escaneado recusa o que não é PDF nem foto', async () => {
    const { service } = montar({ patrocinado: PATROCINADO });
    const planilha = `data:text/csv;base64,${Buffer.from('a,b').toString('base64')}`;
    await expect(
      service.guardarEscaneado('p1', { arquivo: planilha, arquivoNome: 'x.csv' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('contrato assinado pelo link não se apaga', async () => {
    const { service, prisma } = montar({
      contrato: { id: 'c1', origem: OrigemDoContrato.LINK, assinadoEm: new Date() },
    });
    await expect(service.remover('c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.contratoDePatrocinio.delete).not.toHaveBeenCalled();
  });

  it('link não assinado e escaneado se apagam', async () => {
    for (const contrato of [
      { id: 'c1', origem: OrigemDoContrato.LINK, assinadoEm: null },
      { id: 'c2', origem: OrigemDoContrato.ESCANEADO, assinadoEm: new Date() },
    ]) {
      const { service, prisma } = montar({ contrato });
      await service.remover(contrato.id);
      expect(prisma.contratoDePatrocinio.delete).toHaveBeenCalledWith({ where: { id: contrato.id } });
    }
  });

  it('o PDF do assinado sai do retrato, e o não assinado não imprime', async () => {
    const assinado = montar({
      contrato: contratoGravado({ assinadoEm: new Date(), assinaturaPng: PNG_VALIDO, nomeAssinante: 'Carlos' }),
    });
    const arquivo = await assinado.service.paraBaixar('c1');
    expect(arquivo.tipo).toBe('application/pdf');
    expect(arquivo.nome).toBe('contrato-patrocinio-futsal-unidos.pdf');
    expect(arquivo.conteudo.subarray(0, 4).toString('latin1')).toBe('%PDF');

    const aberto = montar();
    await expect(aberto.service.paraBaixar('c1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

/** Um PNG de 1×1 de verdade: o pdfkit lê o arquivo para desenhar. */
const PNG_VALIDO =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
