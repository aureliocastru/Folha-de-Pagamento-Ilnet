import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { AgendaService } from './agenda.service';
import { SalvarAgendaDto } from './dto/agenda.dto';

/** Id de quem está logado (o JwtStrategy põe o usuário na requisição). */
function idDoLogado(req: Request): string {
  return (req.user as { id: string }).id;
}

/**
 * O bloco de notas do canto da tela.
 *
 * Não pertence a módulo nenhum — nem está na tabela do `ModulosGuard` —, e é
 * de propósito: o bloco abre em qualquer tela do sistema, e quem só tem o RH
 * escreve o recado dele do mesmo jeito que quem só tem o caixa.
 *
 * Os quatro perfis estão listados um a um, e a lista é exaustiva como a da
 * troca de senha: sem ela, o `RolesGuard` recusaria a gravação do
 * VISUALIZADOR — a regra geral dele é "só leitura", e ela existe para o
 * dinheiro da empresa, não para o papel de recado de quem está logado. Um
 * perfil novo que esqueça de entrar aqui nasce podendo ler o próprio bloco e
 * não podendo escrever nele.
 */
@Controller('agenda')
@Roles(UserRole.ADMIN, UserRole.RH, UserRole.VISUALIZADOR, UserRole.TECNICO)
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get()
  minha(@Req() req: Request) {
    return this.agenda.minha(idDoLogado(req));
  }

  /**
   * `PUT` porque o corpo é o bloco inteiro, e não um pedaço dele: mandar o
   * mesmo texto duas vezes tem de dar no mesmo.
   */
  @Put()
  salvar(@Req() req: Request, @Body() dto: SalvarAgendaDto) {
    return this.agenda.salvar(idDoLogado(req), dto.texto);
  }
}
