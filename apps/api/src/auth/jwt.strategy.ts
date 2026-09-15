import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { lerPermissoes } from './permissoes';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<AppConfig['jwt']>('jwt').secret,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      // Os módulos vêm do banco, e não do token: tirar um de alguém tem efeito
      // no clique seguinte, e não quando o login dela expirar.
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        ativo: true,
        modulos: true,
        // O perfil também vem do banco a cada pedido: mudar o que um perfil
        // permite vale no clique seguinte de todos os logins que o usam.
        perfil: { select: { id: true, nome: true, permissoes: true } },
      },
    });
    if (!user || !user.ativo) {
      throw new UnauthorizedException('Usuário inválido ou inativo');
    }
    return comPermissoes(user);
  }
}

/**
 * O usuário como a requisição o carrega: o perfil criado, quando há, com as
 * permissões já lidas — `permissoes` null é o login dos perfis fixos de sempre.
 */
export function comPermissoes<
  T extends { role: string; perfil: { id: string; nome: string; permissoes: unknown } | null },
>(user: T) {
  const { perfil, ...resto } = user;
  // ADMIN e TECNICO não usam perfil criado: um distribui acesso, o outro tem
  // a tela dele. Um perfil que sobrou ligado a eles não pesa em nada.
  const vale = perfil && user.role !== 'ADMIN' && user.role !== 'TECNICO';
  return {
    ...resto,
    perfil: vale ? { id: perfil.id, nome: perfil.nome } : null,
    permissoes: vale ? lerPermissoes(perfil.permissoes) : null,
  };
}
