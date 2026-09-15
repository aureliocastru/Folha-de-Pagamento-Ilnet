import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { lerPermissoes } from '../auth/permissoes';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { cifrarSenha, decifrarSenha, gerarSenha } from './cifra-de-senha';
import {
  AtualizarPerfilDto,
  CriarPerfilDto,
} from './dto/perfil.dto';
import { AtualizarUsuarioDto, CriarUsuarioDto } from './dto/usuario.dto';
import { type ColaboradorDoLogin, VinculoDoLoginService } from './vinculo-do-login.service';

/** Nunca devolva o hash nem a senha cifrada na lista. */
const CAMPOS = {
  id: true,
  nome: true,
  email: true,
  role: true,
  modulos: true,
  ativo: true,
  perfil: { select: { id: true, nome: true } },
  // Só para dizer se a senha pode ser vista; o conteúdo não sai daqui.
  senhaCifrada: true,
  createdAt: true,
  updatedAt: true,
} as const;

type LinhaDoUsuario = Prisma.UserGetPayload<{ select: typeof CAMPOS }>;

/**
 * O login como a tela o recebe: sem a cifra, com o aviso de que dá para ver a
 * senha, e com o colaborador que ele é — ligado à mão ou achado pelo nome.
 */
function paraTela(
  { senhaCifrada, ...resto }: LinhaDoUsuario,
  colaborador: ColaboradorDoLogin | null = null,
) {
  return { ...resto, senhaVisivel: !!senhaCifrada, colaborador };
}

const CUSTO_HASH = 10;

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly vinculos: VinculoDoLoginService,
  ) {}

  /** A chave da cifra: um segredo próprio, ou o do JWT na falta dele. */
  private get segredo(): string {
    return (
      process.env.SENHAS_CHAVE?.trim() ||
      this.config.getOrThrow<AppConfig['jwt']>('jwt').secret
    );
  }

  /** O hash que confere a entrada e a cópia cifrada que o administrador vê. */
  private async gravacaoDaSenha(senha: string) {
    return {
      senhaHash: await bcrypt.hash(senha, CUSTO_HASH),
      senhaCifrada: cifrarSenha(senha, this.segredo),
    };
  }

  async listar() {
    const [linhas, vinculos] = await Promise.all([
      this.prisma.user.findMany({
        select: CAMPOS,
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      }),
      this.vinculos.todos(),
    ]);
    return linhas.map((l) => paraTela(l, vinculos.get(l.id)));
  }

  /** Os colaboradores ativos da casa, para escolher de quem é um login. */
  colaboradores() {
    return this.prisma.funcionario.findMany({
      where: { ativo: true, isentoIcms: true },
      select: { id: true, nome: true, apelido: true },
      orderBy: { nome: 'asc' },
    });
  }

  /** Com o colaborador que ele passou a ser, depois de gravar. */
  private async comVinculo(linha: LinhaDoUsuario) {
    return paraTela(linha, await this.vinculos.doLogin(linha.id));
  }

  /**
   * O colaborador pedido existe, ainda é da casa, e não entra por outro login.
   *
   * Uma pessoa, um login. O banco só garante isso para o vínculo feito à mão
   * (a coluna é única); o achado pelo nome se confere aqui — sem isso, criar
   * "Tadeu Fonseca" para quem já entra como "Tadeu" daria duas senhas à mesma
   * pessoa, e a tela do colaborador deixaria de saber qual das duas é ela.
   */
  private async assertColaborador(funcionarioId: string | null | undefined, loginId?: string) {
    if (!funcionarioId) return;
    const existe = await this.prisma.funcionario.findFirst({
      where: { id: funcionarioId, ativo: true, isentoIcms: true },
      select: { id: true },
    });
    if (!existe) {
      throw new BadRequestException('Esse colaborador não está entre os funcionários ativos.');
    }
    for (const [outroId, colaborador] of await this.vinculos.todos()) {
      if (outroId === loginId || colaborador.id !== funcionarioId) continue;
      const dono = await this.prisma.user.findUnique({
        where: { id: outroId },
        select: { nome: true, email: true },
      });
      throw new ConflictException(
        `${colaborador.nomeCompleto} já entra no sistema pelo login de ${dono?.nome} (${dono?.email}). ` +
          'Uma pessoa, um login: use aquele.',
      );
    }
  }

  async criar(dto: CriarUsuarioDto) {
    const acesso = await this.acessoPedido(dto.role, dto.perfilId);
    await this.assertColaborador(dto.funcionarioId);
    try {
      const criado = await this.prisma.user.create({
        data: {
          nome: dto.nome.trim(),
          email: dto.email,
          ...(await this.gravacaoDaSenha(dto.senha)),
          role: acesso.role ?? UserRole.RH,
          perfilId: acesso.perfilId ?? null,
          // Vazio = todos. Ver o comentário da coluna no schema.
          modulos: acesso.perfilId ? [] : (dto.modulos ?? []),
          funcionarioId: dto.funcionarioId ?? null,
        },
        select: CAMPOS,
      });
      return this.comVinculo(criado);
    } catch (err) {
      throw await this.traduzirErro(err, dto.funcionarioId);
    }
  }

  async atualizar(id: string, dto: AtualizarUsuarioDto, usuarioLogadoId: string) {
    await this.assertExiste(id);
    const acesso = await this.acessoPedido(dto.role, dto.perfilId);

    // Ninguém tira o próprio acesso sem querer — e o app não pode ficar sem
    // nenhum administrador ativo. Pôr um perfil criado é deixar de ser ADMIN.
    if (id === usuarioLogadoId) {
      if (dto.ativo === false) {
        throw new BadRequestException('Você não pode desativar o próprio login');
      }
      if (acesso.role && acesso.role !== UserRole.ADMIN) {
        throw new BadRequestException('Você não pode rebaixar o próprio perfil');
      }
    }
    if (dto.ativo === false || (acesso.role && acesso.role !== UserRole.ADMIN)) {
      await this.assertNaoDeixaSemAdmin(id);
    }
    await this.assertColaborador(dto.funcionarioId, id);

    try {
      const atualizado = await this.prisma.user.update({
        where: { id },
        data: {
          nome: dto.nome?.trim(),
          email: dto.email,
          role: acesso.role,
          perfilId: acesso.perfilId,
          modulos: acesso.perfilId ? [] : dto.modulos,
          ativo: dto.ativo,
          funcionarioId: dto.funcionarioId,
          ...(dto.senha ? await this.gravacaoDaSenha(dto.senha) : {}),
        },
        select: CAMPOS,
      });
      return this.comVinculo(atualizado);
    } catch (err) {
      throw await this.traduzirErro(err, dto.funcionarioId);
    }
  }

  /**
   * O que um pedido diz sobre o acesso: o perfil fixo, ou o criado.
   *
   * Perfil criado leva o login a RH — a base que escreve —, e é o perfil que
   * restringe módulo por módulo. Perfil fixo tira o criado. `undefined` nos
   * dois é "não mexeu no acesso".
   */
  private async acessoPedido(
    role: UserRole | undefined,
    perfilId: string | null | undefined,
  ): Promise<{ role?: UserRole; perfilId?: string | null }> {
    if (perfilId) {
      const perfil = await this.prisma.perfilDeAcesso.findUnique({
        where: { id: perfilId },
        select: { id: true },
      });
      if (!perfil) throw new BadRequestException('Esse perfil não existe mais.');
      return { role: UserRole.RH, perfilId };
    }
    if (role) return { role, perfilId: null };
    if (perfilId === null) return { perfilId: null };
    return {};
  }

  async remover(id: string, usuarioLogadoId: string) {
    await this.assertExiste(id);
    if (id === usuarioLogadoId) {
      throw new BadRequestException('Você não pode excluir o próprio login');
    }
    await this.assertNaoDeixaSemAdmin(id);
    await this.prisma.user.delete({ where: { id } });
  }

  /** Troca da própria senha: exige a atual, então ninguém troca por você. */
  async trocarSenha(id: string, senhaAtual: string, novaSenha: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const confere = await bcrypt.compare(senhaAtual, user.senhaHash);
    if (!confere) throw new BadRequestException('A senha atual não confere');
    if (await bcrypt.compare(novaSenha, user.senhaHash)) {
      throw new BadRequestException('A nova senha precisa ser diferente da atual');
    }

    await this.prisma.user.update({
      where: { id },
      data: await this.gravacaoDaSenha(novaSenha),
    });
    return { ok: true };
  }

  /**
   * A senha de um login, para o administrador.
   *
   * Fica no log quem viu a de quem: é a única leitura de senha do sistema, e
   * ela precisa deixar rastro.
   */
  async verSenha(id: string, quemViu: string): Promise<{ senha: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { nome: true, senhaCifrada: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    const senha = user.senhaCifrada ? decifrarSenha(user.senhaCifrada, this.segredo) : null;
    if (!senha) {
      throw new NotFoundException(
        'A senha deste login é de antes de o sistema guardá-las, e não tem como ser lida. ' +
          'Gere uma senha nova — a partir dela, dá para ver sempre.',
      );
    }
    this.logger.log(`${quemViu} viu a senha de ${user.nome}.`);
    return { senha };
  }

  /** Uma senha nova, gerada aqui, gravada e devolvida para ser passada à pessoa. */
  async gerarSenhaNova(id: string, quemGerou: string): Promise<{ senha: string }> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { nome: true } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    const senha = gerarSenha();
    await this.prisma.user.update({ where: { id }, data: await this.gravacaoDaSenha(senha) });
    this.logger.log(`${quemGerou} gerou uma senha nova para ${user.nome}.`);
    return { senha };
  }

  // --- Perfis de acesso ---

  async listarPerfis() {
    const perfis = await this.prisma.perfilDeAcesso.findMany({
      orderBy: { nome: 'asc' },
      include: { _count: { select: { usuarios: true } } },
    });
    return perfis.map(({ _count, permissoes, ...p }) => ({
      ...p,
      permissoes: lerPermissoes(permissoes),
      usuarios: _count.usuarios,
    }));
  }

  async criarPerfil(dto: CriarPerfilDto) {
    try {
      return await this.prisma.perfilDeAcesso.create({
        data: {
          nome: dto.nome.trim(),
          descricao: dto.descricao?.trim() || null,
          permissoes: lerPermissoes(dto.permissoes),
        },
      });
    } catch (err) {
      throw this.traduzirErroDoPerfil(err);
    }
  }

  async atualizarPerfil(id: string, dto: AtualizarPerfilDto) {
    const existe = await this.prisma.perfilDeAcesso.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw new NotFoundException('Perfil não encontrado');
    try {
      return await this.prisma.perfilDeAcesso.update({
        where: { id },
        data: {
          nome: dto.nome?.trim(),
          descricao: dto.descricao === undefined ? undefined : dto.descricao?.trim() || null,
          permissoes: dto.permissoes ? lerPermissoes(dto.permissoes) : undefined,
        },
      });
    } catch (err) {
      throw this.traduzirErroDoPerfil(err);
    }
  }

  /** Perfil em uso não se apaga: os logins dele ficariam sem saber o que abrem. */
  async removerPerfil(id: string) {
    const usando = await this.prisma.user.count({ where: { perfilId: id } });
    if (usando > 0) {
      throw new BadRequestException(
        `${usando} login(s) usam este perfil. Troque o perfil deles antes de apagar.`,
      );
    }
    await this.prisma.perfilDeAcesso.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Perfil não encontrado');
    });
  }

  /** O último administrador ativo não pode ser desligado nem rebaixado. */
  private async assertNaoDeixaSemAdmin(idAlvo: string) {
    const outros = await this.prisma.user.count({
      where: { role: UserRole.ADMIN, ativo: true, id: { not: idAlvo } },
    });
    if (outros === 0) {
      throw new BadRequestException(
        'Este é o único administrador ativo — promova outra pessoa antes.',
      );
    }
  }

  private async assertExiste(id: string) {
    const existe = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Usuário não encontrado');
  }

  private async traduzirErro(err: unknown, funcionarioId?: string | null): Promise<Error> {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      // Duas colunas únicas: o e-mail e o colaborador. O alvo diz qual foi.
      const alvo = JSON.stringify(err.meta?.target ?? '');
      if (funcionarioId && alvo.includes('funcionario')) {
        const dono = await this.prisma.user.findUnique({
          where: { funcionarioId },
          select: { nome: true, email: true },
        });
        return new ConflictException(
          dono
            ? `Esse colaborador já é o login de ${dono.nome} (${dono.email}). Uma pessoa, um login: ` +
                'use aquele, ou tire o vínculo dele antes.'
            : 'Esse colaborador já está ligado a outro login.',
        );
      }
      return new ConflictException('Já existe um login com esse e-mail');
    }
    return err as Error;
  }

  private traduzirErroDoPerfil(err: unknown): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('Já existe um perfil com esse nome');
    }
    return err as Error;
  }
}
