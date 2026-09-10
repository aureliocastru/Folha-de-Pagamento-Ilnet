import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { cpfValido } from './cpf';
import { PontuacaoService } from './pontuacao.service';

/**
 * A pontuação dos funcionários. O que este arquivo protege:
 *
 *  - o CPF digitado com um dígito trocado não vira login;
 *  - a posição é justa no empate ("1º, 2º, 2º, 4º");
 *  - a senha do coordenador trava depois de errar demais, e a mensagem não
 *    diz se foi o CPF ou a senha que errou;
 *  - o token do portal só abre o portal;
 *  - coordenador apaga só o que ele mesmo lançou; o ADMIN apaga tudo;
 *  - ponto é sempre +1 ou −1, e sempre com motivo;
 *  - a foto de um ponto só se vê pelo CPF do próprio funcionário.
 */

// CPFs de teste, gerados só para fechar a conta dos dígitos — de ninguém.
const CPF_COORD = '52998224725';
const CPF_ANA = '11144477735';

/** Um JPEG de mentira: só o começo do arquivo, o bastante para ter tipo e corpo. */
const FOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

const funcionarios = [
  { id: 'f-ana', nome: 'Ana Souza', apelido: null, funcao: 'Técnica', cpfCnpj: '111.444.777-35' },
  { id: 'f-bia', nome: 'Bia Lima', apelido: 'Bia', funcao: null, cpfCnpj: null },
  { id: 'f-caio', nome: 'Caio Reis', apelido: null, funcao: null, cpfCnpj: null },
  { id: 'f-duda', nome: 'Duda Melo', apelido: null, funcao: null, cpfCnpj: null },
];

function montar(
  opts: {
    somas?: Array<{ funcionarioId: string; pontos: number; qtd: number }>;
    coordenador?: Record<string, unknown> | null;
    lancamento?: Record<string, unknown> | null;
    foto?: Record<string, unknown> | null;
    motivoRepetido?: Record<string, unknown> | null;
  } = {},
) {
  const prisma = {
    funcionario: {
      findMany: jest.fn(async () => funcionarios),
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        funcionarios.find((f) => f.id === where.id) ?? null,
      ),
    },
    lancamentoDePontos: {
      groupBy: jest.fn(async ({ by }: { by: string[] }) =>
        by[0] === 'funcionarioId'
          ? (opts.somas ?? []).map((s) => ({
              funcionarioId: s.funcionarioId,
              _sum: { pontos: s.pontos },
              _count: { _all: s.qtd },
            }))
          : [],
      ),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => opts.lancamento ?? null),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
      delete: jest.fn(),
    },
    fotoDosPontos: {
      findUnique: jest.fn(async () => opts.foto ?? null),
    },
    motivoDePontos: {
      findFirst: jest.fn(async () => opts.motivoRepetido ?? null),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
    },
    coordenadorPontuacao: {
      findFirst: jest.fn(async () => opts.coordenador ?? null),
      findUnique: jest.fn(async () => opts.coordenador ?? null),
      update: jest.fn(),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'novo',
        ...data,
      })),
    },
  };
  const jwt = new JwtService({ secret: 'teste::pontuacao', signOptions: { expiresIn: '1h' } });
  const service = new PontuacaoService(prisma as never, jwt);
  return { service, prisma, jwt };
}

const admin = { tipo: 'admin', id: 'u1', nome: 'Administrador' } as const;
const coordenador = { tipo: 'coordenador', id: 'c1', nome: 'Coordenadora' } as const;

describe('cpfValido', () => {
  it('confere os dígitos verificadores', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-26')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('5299822472')).toBe(false);
  });
});

describe('PontuacaoService.painel', () => {
  it('todos os funcionários entram, e o empate divide a posição', async () => {
    const { service } = montar({
      somas: [
        { funcionarioId: 'f-bia', pontos: 10, qtd: 2 },
        { funcionarioId: 'f-caio', pontos: 5, qtd: 1 },
        { funcionarioId: 'f-duda', pontos: 5, qtd: 1 },
      ],
    });
    const r = await service.painel('2026-09');
    expect(r.funcionarios.map((f) => [f.nome, f.pontos, f.posicao])).toEqual([
      ['Bia Lima', 10, 1],
      ['Caio Reis', 5, 2],
      ['Duda Melo', 5, 2],
      ['Ana Souza', 0, 4],
    ]);
  });
});

describe('PontuacaoService — o portal', () => {
  it('o CPF de um funcionário abre a tela dele, com a posição e sem os colegas', async () => {
    const { service } = montar({
      somas: [
        { funcionarioId: 'f-bia', pontos: 10, qtd: 2 },
        { funcionarioId: 'f-ana', pontos: 7, qtd: 1 },
      ],
    });
    const r = await service.visaoDoFuncionario(CPF_ANA, '2026-09');
    expect(r).toMatchObject({ nome: 'Ana Souza', pontos: 7, posicao: 2, de: 4 });
    expect(r).not.toHaveProperty('funcionarios');
    expect(r.meses).toHaveLength(6);
  });

  it('CPF que não é de ninguém da empresa diz isso', async () => {
    const { service } = montar();
    await expect(service.identificar('529.982.247-25')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('coordenador que também é funcionário abre as duas telas', async () => {
    const { service } = montar({ coordenador: { nome: 'Ana Souza' } });
    await expect(service.identificar(CPF_ANA)).resolves.toEqual({
      coordenador: true,
      funcionario: true,
      nome: 'Ana',
    });
  });
});

describe('PontuacaoService.entrar', () => {
  async function coord(over: Record<string, unknown> = {}) {
    return {
      id: 'c1',
      nome: 'Coordenadora',
      cpf: CPF_COORD,
      senhaHash: await bcrypt.hash('1234', 4),
      ativo: true,
      tentativas: 0,
      bloqueadoAte: null,
      ...over,
    };
  }

  it('senha certa devolve um token que só o portal aceita', async () => {
    const { service } = montar({ coordenador: await coord() });
    const r = await service.entrar(CPF_COORD, '1234');
    const c = await service.coordenadorDoToken(r.token);
    expect(c.id).toBe('c1');

    // Assinado com a chave do sistema, ele não abre o portal.
    const doSistema = new JwtService({ secret: 'teste' });
    const intruso = await doSistema.signAsync({ sub: 'c1', tipo: 'coordenador-pontuacao' });
    await expect(service.coordenadorDoToken(intruso)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('senha errada não diz se o erro foi no CPF ou na senha', async () => {
    const { service, prisma } = montar({ coordenador: await coord() });
    await expect(service.entrar(CPF_COORD, '9999')).rejects.toThrow(
      'CPF ou senha não conferem.',
    );
    expect(prisma.coordenadorPontuacao.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tentativas: 1 }) }),
    );
  });

  it('a quinta senha errada trava o login', async () => {
    const { service, prisma } = montar({ coordenador: await coord({ tentativas: 4 }) });
    await expect(service.entrar(CPF_COORD, '9999')).rejects.toThrow(
      UnauthorizedException,
    );
    const dados = (prisma.coordenadorPontuacao.update.mock.calls[0] as unknown as [
      { data: { bloqueadoAte: Date | null } },
    ])[0].data;
    expect(dados.bloqueadoAte).toBeInstanceOf(Date);
  });

  it('travado não entra nem com a senha certa', async () => {
    const { service } = montar({
      coordenador: await coord({ bloqueadoAte: new Date(Date.now() + 60_000) }),
    });
    await expect(service.entrar(CPF_COORD, '1234')).rejects.toThrow(ForbiddenException);
  });

  it('desligado não entra', async () => {
    const { service } = montar({ coordenador: await coord({ ativo: false }) });
    await expect(service.entrar(CPF_COORD, '1234')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('PontuacaoService.lancar', () => {
  it('grava os pontos com o motivo, o mês e o nome de quem deu', async () => {
    const { service, prisma } = montar();
    await service.lancar(
      { funcionarioId: 'f-ana', pontos: -1, motivo: 'Chegou atrasada', data: '2026-09-08' },
      coordenador,
    );
    expect(prisma.lancamentoDePontos.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        funcionarioId: 'f-ana',
        pontos: -1,
        competencia: '2026-09',
        coordenadorId: 'c1',
        usuarioId: null,
        lancadoPor: 'Coordenadora',
      }),
    });
    const { data } = prisma.lancamentoDePontos.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data).not.toHaveProperty('foto');
  });

  it('a foto vai junto, na tabela dela', async () => {
    const { service, prisma } = montar();
    await service.lancar(
      { funcionarioId: 'f-ana', pontos: 1, motivo: 'Caixa organizada', foto: FOTO },
      coordenador,
    );
    expect(prisma.lancamentoDePontos.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ foto: { create: { foto: FOTO } } }),
    });
  });

  it.each([
    [{ pontos: 0, motivo: 'Zero não' }],
    [{ pontos: 5, motivo: 'Cada ponto é um' }],
    [{ pontos: -2, motivo: 'Cada ponto é um' }],
    [{ pontos: 1, motivo: '' }],
    [{ pontos: 1, motivo: 'Foto que não é foto', foto: 'data:application/pdf;base64,JVBERi0=' }],
    [{ pontos: 1, motivo: 'Foto quebrada', foto: 'não é data url' }],
  ])('recusa %j', async (dados) => {
    const { service, prisma } = montar();
    await expect(
      service.lancar({ funcionarioId: 'f-ana', ...dados }, admin),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.lancamentoDePontos.create).not.toHaveBeenCalled();
  });
});

describe('PontuacaoService.fotoDoFuncionario', () => {
  it('o funcionário vê a foto dos próprios pontos', async () => {
    const { service } = montar({ foto: { foto: FOTO, lancamento: { funcionarioId: 'f-ana' } } });
    await expect(service.fotoDoFuncionario(CPF_ANA, 'l1')).resolves.toEqual({ foto: FOTO });
  });

  it('e não a dos pontos de um colega', async () => {
    const { service } = montar({ foto: { foto: FOTO, lancamento: { funcionarioId: 'f-bia' } } });
    await expect(service.fotoDoFuncionario(CPF_ANA, 'l1')).rejects.toThrow(NotFoundException);
  });
});

describe('PontuacaoService motivos', () => {
  it('limpa os espaços e grava do lado pedido', async () => {
    const { service, prisma } = montar();
    await service.criarMotivo({ texto: '  Uniforme   completo ', positivo: true });
    expect(prisma.motivoDePontos.create).toHaveBeenCalledWith({
      data: { texto: 'Uniforme completo', positivo: true },
    });
  });

  it('recusa o repetido do mesmo lado', async () => {
    const { service, prisma } = montar({ motivoRepetido: { texto: 'Atraso' } });
    await expect(service.criarMotivo({ texto: 'atraso', positivo: false })).rejects.toThrow(
      /já está entre os motivos a menos/,
    );
    expect(prisma.motivoDePontos.create).not.toHaveBeenCalled();
  });
});

describe('PontuacaoService.apagar', () => {
  it('coordenador apaga o que ele deu', async () => {
    const { service, prisma } = montar({ lancamento: { id: 'l1', coordenadorId: 'c1', pontos: 5 } });
    await service.apagar('l1', coordenador);
    expect(prisma.lancamentoDePontos.delete).toHaveBeenCalled();
  });

  it('coordenador não apaga o que outro deu', async () => {
    const { service, prisma } = montar({ lancamento: { id: 'l1', coordenadorId: 'c2', pontos: 5 } });
    await expect(service.apagar('l1', coordenador)).rejects.toThrow(ForbiddenException);
    expect(prisma.lancamentoDePontos.delete).not.toHaveBeenCalled();
  });

  it('o ADMIN apaga qualquer um', async () => {
    const { service, prisma } = montar({ lancamento: { id: 'l1', coordenadorId: 'c2', pontos: 5 } });
    await service.apagar('l1', admin);
    expect(prisma.lancamentoDePontos.delete).toHaveBeenCalled();
  });
});

describe('PontuacaoService.criarCoordenador', () => {
  it('recusa CPF que não fecha, e senha que não é de 4 a 6 números', async () => {
    const { service } = montar();
    await expect(
      service.criarCoordenador({ nome: 'X', cpf: '529.982.247-26', senha: '1234' }),
    ).rejects.toThrow(/dígitos verificadores/);
    await expect(
      service.criarCoordenador({ nome: 'X', cpf: CPF_COORD, senha: 'abc' }),
    ).rejects.toThrow(/4 a 6 números/);
  });

  it('guarda só os dígitos do CPF e o hash da senha', async () => {
    const { service, prisma } = montar();
    await service.criarCoordenador({ nome: ' Coord ', cpf: '529.982.247-25', senha: '4321' });
    const dados = (prisma.coordenadorPontuacao.create.mock.calls[0] as unknown as [
      { data: { cpf: string; senhaHash: string; nome: string } },
    ])[0].data;
    expect(dados.cpf).toBe(CPF_COORD);
    expect(dados.nome).toBe('Coord');
    expect(dados.senhaHash).not.toBe('4321');
    expect(await bcrypt.compare('4321', dados.senhaHash)).toBe(true);
  });
});
