import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { AReceberService } from './a-receber.service';
import {
  CriarAReceberDto,
  EditarAReceberDto,
  RecebidoDto,
} from './dto/a-receber.dto';

/** Id de quem está logado (o JwtStrategy põe o usuário na requisição). */
function idDoLogado(req: Request): string {
  return (req.user as { id: string }).id;
}

/**
 * A aba Controle do Contas a Pagar: quem deve a quem está logado.
 *
 * Os três perfis do módulo escrevem, o VISUALIZADOR inclusive: a regra dele é
 * "só leitura" do dinheiro da empresa, e isto é lembrete particular de quem
 * entrou — como o bloco de notas.
 */
@Controller('a-receber')
@Roles(UserRole.ADMIN, UserRole.RH, UserRole.VISUALIZADOR)
export class AReceberController {
  constructor(private readonly service: AReceberService) {}

  @Get()
  listar(@Req() req: Request) {
    return this.service.listar(idDoLogado(req));
  }

  @Post()
  @HttpCode(201)
  criar(@Req() req: Request, @Body() dto: CriarAReceberDto) {
    return this.service.criar(idDoLogado(req), dto);
  }

  @Patch(':id')
  editar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: EditarAReceberDto,
  ) {
    return this.service.editar(idDoLogado(req), id, dto);
  }

  /** `PUT` porque diz o estado inteiro: pagou, ou ainda deve. */
  @Put(':id/recebido')
  recebido(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RecebidoDto,
  ) {
    return this.service.marcarRecebido(idDoLogado(req), id, dto.recebido);
  }

  @Delete(':id')
  @HttpCode(200)
  async apagar(@Req() req: Request, @Param('id') id: string) {
    await this.service.apagar(idDoLogado(req), id);
    return { ok: true };
  }
}
