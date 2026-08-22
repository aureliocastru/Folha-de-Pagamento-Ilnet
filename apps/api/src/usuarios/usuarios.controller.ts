import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import {
  AtualizarUsuarioDto,
  CriarUsuarioDto,
  TrocarSenhaDto,
} from './dto/usuario.dto';
import { UsuariosService } from './usuarios.service';

/** Id de quem está logado (o JwtStrategy põe o usuário na requisição). */
function idDoLogado(req: Request): string {
  return (req.user as { id: string }).id;
}

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  /**
   * Trocar a própria senha vale para qualquer perfil.
   *
   * A lista é exaustiva, e não um "todos": um perfil novo que esqueça de entrar
   * aqui nasce sem conseguir trocar a própria senha — foi o que aconteceu com o
   * TECNICO.
   */
  @Roles(
    UserRole.ADMIN,
    UserRole.RH,
    UserRole.VISUALIZADOR,
    UserRole.TECNICO,
  )
  @Post('minha-senha')
  @HttpCode(200)
  trocarSenha(@Req() req: Request, @Body() dto: TrocarSenhaDto) {
    return this.usuarios.trocarSenha(
      idDoLogado(req),
      dto.senhaAtual,
      dto.novaSenha,
    );
  }

  // --- Daqui para baixo, só administrador ---
  @Roles(UserRole.ADMIN)
  @Get()
  listar() {
    return this.usuarios.listar();
  }

  @Roles(UserRole.ADMIN)
  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarUsuarioDto) {
    return this.usuarios.criar(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body() dto: AtualizarUsuarioDto,
    @Req() req: Request,
  ) {
    return this.usuarios.atualizar(id, dto, idDoLogado(req));
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(200)
  async remover(@Param('id') id: string, @Req() req: Request) {
    await this.usuarios.remover(id, idDoLogado(req));
    return { ok: true };
  }
}
