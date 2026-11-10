import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { ModoAssinatura, Prisma } from '@prisma/client';
import { declaracaoDaNota } from './nota.pdf';
import { NotasDeRecebimentoService, VALIDADE_DA_NOTA_DIAS } from './notas.service';

/**
 * O que este arquivo protege: a nota de recebimento diz o valor do título no
 * IXC — e não o que a tela mandou —, é uma por pagamento, não muda depois de
 * assinada, não é assinada duas vezes, não se apaga depois de assinada, e só a
 * assinada recebe baixa.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** Um PNG de 1×1 de verdade: o pdfkit lê o arquivo para desenhar. */
const PNG_VALIDO =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const PATROCINADO = {
  id: 'p1',
  tipo: 'FIXO',
  nome: 'Maria Clara',
  projeto: 'Atleta de jiu-jitsu',
  cpfCnpj: '123.456.789-00',
  responsavel: 'Joana Mãe',
  idFornecedorIxc: 77,
};

const PAGO_OUTUBRO = {
  idFnApagar: 502,
  situacao: 'PAGO' as const,
  valor: 300,
  vencimento: new Date('2026-10-05T00:00:00Z'),
  pagoEm: new Date('2026-10-06T00:00:00Z'),
  descricao: 'Patrocínio Maria Clara - outubro de 2026',
  documento: null,
};

function notaGravada(over: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    patrocinadoId: 'p1',
    idFnApagar: 502,
    token: 'tok',
    expiraEm: new Date(Date.now() + 86_400_000),
    valor: new Prisma.Decimal(300),
    referente: 'Patrocínio Maria Clara - outubro de 2026',
    vencimento: PAGO_OUTUBRO.vencimento,
    pagoEm: PAGO_OUTUBRO.pagoEm,
    nomePatrocinado: 'Maria Clara',
    cpfPatrocinado: '123.456.789-00',
    projeto: 'Atleta de jiu-jitsu',
    empresaNome: 'ILNET',
    empresaCnpj: '11.111.111/0001-11',
    assinaturaPng: null,
    assinadoEm: null,
    modo: ModoAssinatura.DESENHADA,
    nomeAssinante: null,
    ip: null,
    userAgent: null,
    baixadaEm: null,
    baixadaPor: null,
    criadoPor: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    patrocinado: { responsavel: 'Joana Mãe' },
    ...over,
  };
}

function montar(
  opts: {
    patrocinado?: Record<string, unknown> | null;
    existente?: Record<string, unknown> | null;
    nota?: Record<string, unknown> | null;
    pagamentos?: Array<Record<string, unknown>>;
    afetadas?: number;
    apagadas?: number;
  } = {},
) {
  const nota = opts.nota === undefined ? notaGravada() : opts.nota;
  const prisma = {
    patrocinado: {
      findUnique: jest.fn().mockResolvedValue(opts.patrocinado === undefined ? PATROCINADO : opts.patrocinado),
    },
    notaDeRecebimento: {
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        'idFnApagar' in where ? (opts.existente ?? null) : nota,
      ),
      findUniqueOrThrow: jest.fn(async () => nota),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'nova', ...data })),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: opts.afetadas ?? 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: opts.apagadas ?? 1 }),
    },
  };
  const config = { obter: jest.fn().mockResolvedValue({ empresaNome: 'ILNET', empresaCnpj: '11.111.111/0001-11' }) };
  const patrocinio = {
    pagamentosDoFornecedor: jest.fn().mockResolvedValue(opts.pagamentos ?? [PAGO_OUTUBRO]),
  };
  const service = new NotasDeRecebimentoService(prisma as never, config as never, patrocinio as never);
  return { service, prisma, patrocinio };
}

describe('NotasDeRecebimentoService — o link', () => {
  it('o valor e a referência vêm do título no IXC, e o link vence em 15 dias', async () => {
    const { service, prisma, patrocinio } = montar();
    const antes = Date.now();
    await service.gerarLink('p1', 502, 'u1');

    expect(patrocinio.pagamentosDoFornecedor).toHaveBeenCalledWith(77);
    const { data } = prisma.notaDeRecebimento.create.mock.calls[0][0];
    expect(data).toMatchObject({
      patrocinadoId: 'p1',
      idFnApagar: 502,
      referente: 'Patrocínio Maria Clara - outubro de 2026',
      vencimento: PAGO_OUTUBRO.vencimento,
      pagoEm: PAGO_OUTUBRO.pagoEm,
      nomePatrocinado: 'Maria Clara',
      cpfPatrocinado: '123.456.789-00',
      empresaNome: 'ILNET',
      criadoPor: 'u1',
    });
    expect(data.valor).toEqual(new Prisma.Decimal(300));
    expect(data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const prazo = (data.expiraEm as Date).getTime() - antes;
    expect(Math.round(prazo / 86_400_000)).toBe(VALIDADE_DA_NOTA_DIAS);
  });

  it('título sem descrição no IXC: a nota diz de quem e de quando', async () => {
    const { service, prisma } = montar({ pagamentos: [{ ...PAGO_OUTUBRO, descricao: null }] });
    await service.gerarLink('p1', 502);
    expect(prisma.notaDeRecebimento.create.mock.calls[0][0].data.referente).toBe(
      'patrocínio de Maria Clara com vencimento em 05/10/2026',
    );
  });

  it('título que não é deste patrocinado não vira nota', async () => {
    const { service, prisma } = montar({ pagamentos: [{ ...PAGO_OUTUBRO, idFnApagar: 999 }] });
    await expect(service.gerarLink('p1', 502)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notaDeRecebimento.create).not.toHaveBeenCalled();
  });

  it('nota aberta do mesmo pagamento é renovada, e não duplicada', async () => {
    const { service, prisma } = montar({ existente: notaGravada() });
    await service.gerarLink('p1', 502);
    expect(prisma.notaDeRecebimento.create).not.toHaveBeenCalled();
    expect(prisma.notaDeRecebimento.updateMany.mock.calls[0][0].where).toEqual({ id: 'n1', assinadoEm: null });
  });

  it('nota já assinada não se gera de novo, nem chega a perguntar ao IXC', async () => {
    const { service, patrocinio } = montar({ existente: notaGravada({ assinadoEm: new Date() }) });
    await expect(service.gerarLink('p1', 502)).rejects.toThrow(/já foi assinada/);
    expect(patrocinio.pagamentosDoFornecedor).not.toHaveBeenCalled();
  });

  it('a assinatura que chega no meio da renovação ganha: o link dela não é trocado', async () => {
    const { service } = montar({ existente: notaGravada(), afetadas: 0 });
    await expect(service.gerarLink('p1', 502)).rejects.toThrow(/acabou de ser assinada/);
  });

  it('desconto na mensalidade sem fornecedor não tem nota', async () => {
    const { service } = montar({ patrocinado: { ...PATROCINADO, tipo: 'DESCONTO', idFornecedorIxc: null } });
    await expect(service.gerarLink('p1', 502)).rejects.toThrow(/desconto na mensalidade/);
  });

  it('duas telas gerando a nota do mesmo pagamento: o banco desempata com frase', async () => {
    const { service, prisma } = montar();
    prisma.notaDeRecebimento.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.gerarLink('p1', 502)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('NotasDeRecebimentoService — de quem assina', () => {
  it('abre a nota com o valor congelado e sugere o responsável para assinar', async () => {
    const { service } = montar();
    const n = await service.abrirPorToken('tok');
    expect(n.valor).toBe('300');
    expect(n.quemAssina).toBe('Joana Mãe');
    expect(n.assinado).toBe(false);
  });

  it('link vencido sem assinatura não abre; assinado abre como comprovante', async () => {
    const vencido = montar({ nota: notaGravada({ expiraEm: new Date(Date.now() - 1000) }) });
    await expect(vencido.service.abrirPorToken('tok')).rejects.toBeInstanceOf(GoneException);

    const assinado = montar({
      nota: notaGravada({ expiraEm: new Date(Date.now() - 1000), assinadoEm: new Date(), assinaturaPng: PNG }),
    });
    expect((await assinado.service.abrirPorToken('tok')).assinado).toBe(true);
  });

  it('assina uma vez só, guardando de onde veio', async () => {
    const { service, prisma } = montar();
    await service.assinar('tok', { assinatura: PNG }, { ip: '10.0.0.1', userAgent: 'Celular' });
    expect(prisma.notaDeRecebimento.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'n1', token: 'tok', assinadoEm: null },
      data: { assinaturaPng: PNG, nomeAssinante: 'Joana Mãe', ip: '10.0.0.1', userAgent: 'Celular' },
    });
  });

  it('o segundo toque no botão é recusado', async () => {
    const { service } = montar({ afetadas: 0 });
    await expect(service.assinar('tok', { assinatura: PNG }, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('link que não existe', async () => {
    const { service } = montar({ nota: null });
    await expect(service.abrirPorToken('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('NotasDeRecebimentoService — a baixa', () => {
  it('dá baixa na assinada, com o nome de quem deu', async () => {
    const { service, prisma } = montar({ nota: notaGravada({ assinadoEm: new Date(), baixadaEm: new Date() }) });
    await service.darBaixa('n1', ' Henrico ');
    expect(prisma.notaDeRecebimento.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'n1', assinadoEm: { not: null }, baixadaEm: null },
      data: { baixadaPor: 'Henrico' },
    });
  });

  it('a não assinada não recebe baixa', async () => {
    const { service } = montar({ afetadas: 0 });
    await expect(service.darBaixa('n1', 'Henrico')).rejects.toThrow(/não foi assinada/);
  });

  it('dar baixa de novo no que já foi baixado só confirma', async () => {
    const { service } = montar({ afetadas: 0, nota: notaGravada({ assinadoEm: new Date(), baixadaEm: new Date() }) });
    await expect(service.darBaixa('n1', 'Henrico')).resolves.toMatchObject({ id: 'n1' });
  });

  it('desfazer a baixa devolve a nota para "a dar baixa"', async () => {
    const { service, prisma } = montar({ nota: notaGravada({ assinadoEm: new Date(), baixadaEm: new Date() }) });
    await service.desfazerBaixa('n1');
    expect(prisma.notaDeRecebimento.update.mock.calls[0][0]).toEqual({
      where: { id: 'n1' },
      data: { baixadaEm: null, baixadaPor: null },
    });
  });

  it('cada aba pergunta o que é dela', async () => {
    const { service, prisma } = montar();
    await service.listar('A_BAIXAR');
    expect(prisma.notaDeRecebimento.findMany.mock.calls[0][0]).toMatchObject({
      where: { assinadoEm: { not: null }, baixadaEm: null },
      orderBy: { assinadoEm: 'asc' },
    });
  });
});

describe('NotasDeRecebimentoService — apagar e imprimir', () => {
  it('cancela o link que ninguém assinou', async () => {
    const { service, prisma } = montar();
    await service.remover('n1');
    expect(prisma.notaDeRecebimento.deleteMany).toHaveBeenCalledWith({ where: { id: 'n1', assinadoEm: null } });
  });

  it('a assinada não se apaga', async () => {
    const { service } = montar({ apagadas: 0, nota: notaGravada({ assinadoEm: new Date() }) });
    await expect(service.remover('n1')).rejects.toThrow(/não se apaga/);
  });

  it('o PDF da assinada sai do retrato, e a não assinada não imprime', async () => {
    const assinada = montar({
      nota: notaGravada({ assinadoEm: new Date(), assinaturaPng: PNG_VALIDO, nomeAssinante: 'Joana Mãe' }),
    });
    const arquivo = await assinada.service.paraBaixar('n1');
    expect(arquivo.tipo).toBe('application/pdf');
    expect(arquivo.nome).toBe('nota-de-recebimento-maria-clara-502.pdf');
    expect(arquivo.conteudo.subarray(0, 4).toString('latin1')).toBe('%PDF');

    const aberta = montar();
    await expect(aberta.service.paraBaixar('n1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('declaracaoDaNota', () => {
  const base = {
    empresa: { nome: 'ILNET', cnpj: '11.111.111/0001-11' },
    patrocinado: { nome: 'Maria Clara', cpfCnpj: null, projeto: 'Atleta de jiu-jitsu' },
    valor: 300,
    referente: 'Patrocínio Maria Clara - outubro de 2026',
  };

  it('quem assina pelo patrocinado diz em nome de quem recebeu', () => {
    const texto = declaracaoDaNota({ ...base, nomeAssinante: 'Joana Mãe' });
    expect(texto).toMatch(/^Eu, Joana Mãe, como responsável por Maria Clara, declaro que recebi de ILNET/);
    expect(texto).toContain('R$ 300,00 (trezentos reais)');
    expect(texto).toContain('ao projeto "Atleta de jiu-jitsu"');
  });

  it('o próprio patrocinado só declara', () => {
    expect(declaracaoDaNota({ ...base, nomeAssinante: 'maria  clara' })).toMatch(/^Declaro que recebi de ILNET/);
  });
});
