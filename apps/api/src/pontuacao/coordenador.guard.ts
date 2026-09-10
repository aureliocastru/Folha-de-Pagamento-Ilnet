import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CoordenadorPontuacao } from '@prisma/client';
import type { Request } from 'express';
import { PontuacaoService } from './pontuacao.service';

/** A requisição do portal, depois de o guard achar o coordenador. */
export type RequisicaoDoCoordenador = Request & {
  coordenador: CoordenadorPontuacao;
};

/**
 * A porta do coordenador no portal de pontos.
 *
 * As rotas do portal são públicas para o guard do sistema — coordenador não é
 * login do sistema —, e é este aqui que confere o token delas. Ele relê o
 * coordenador a cada pedido: desligado pelo administrador, perde o acesso no
 * clique seguinte.
 */
@Injectable()
export class CoordenadorGuard implements CanActivate {
  constructor(private readonly pontuacao: PontuacaoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequisicaoDoCoordenador>();
    const cabecalho = req.headers.authorization ?? '';
    const [tipo, token] = cabecalho.split(' ');
    if (tipo !== 'Bearer' || !token) {
      throw new UnauthorizedException('Entre com o CPF e a senha.');
    }
    req.coordenador = await this.pontuacao.coordenadorDoToken(token);
    return true;
  }
}
