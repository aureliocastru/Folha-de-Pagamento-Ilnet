import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import {
  AtualizarCoordenadorDto,
  AtualizarMotivoDto,
  CriarCoordenadorDto,
  CriarMotivoDto,
  LancarPontosDto,
} from './dto/pontuacao.dto';
import { type Autor, PontuacaoService } from './pontuacao.service';

function autor(req: Request): Autor {
  const u = req.user as { id: string; nome: string };
  return { tipo: 'admin', id: u.id, nome: u.nome };
}

/**
 * A pontuação vista de dentro do sistema — só ADMIN, e sem login novo.
 *
 * É o mesmo painel que o coordenador vê no portal, com duas coisas a mais: o
 * ADMIN apaga qualquer lançamento, e é ele quem cadastra os coordenadores.
 */
@Roles(UserRole.ADMIN)
@Controller('pontuacao')
export class PontuacaoController {
  constructor(private readonly service: PontuacaoService) {}

  @Get('painel')
  painel(@Query('competencia') competencia?: string) {
    return this.service.painel(competencia);
  }

  @Get('funcionarios/:id/lancamentos')
  lancamentos(
    @Param('id') id: string,
    @Query('competencia') competencia: string | undefined,
    @Req() req: Request,
  ) {
    return this.service.lancamentosDe(id, competencia, autor(req));
  }

  @Post('lancamentos')
  @HttpCode(201)
  lancar(@Body() dto: LancarPontosDto, @Req() req: Request) {
    return this.service.lancar(dto, autor(req));
  }

  @Delete('lancamentos/:id')
  @HttpCode(200)
  async apagar(@Param('id') id: string, @Req() req: Request) {
    await this.service.apagar(id, autor(req));
    return { ok: true };
  }

  @Get('lancamentos/:id/foto')
  foto(@Param('id') id: string) {
    return this.service.fotoDoLancamento(id);
  }

  @Get('motivos')
  motivos() {
    return this.service.listarMotivos();
  }

  @Post('motivos')
  @HttpCode(201)
  criarMotivo(@Body() dto: CriarMotivoDto) {
    return this.service.criarMotivo(dto);
  }

  @Patch('motivos/:id')
  atualizarMotivo(@Param('id') id: string, @Body() dto: AtualizarMotivoDto) {
    return this.service.atualizarMotivo(id, dto);
  }

  @Delete('motivos/:id')
  @HttpCode(200)
  async removerMotivo(@Param('id') id: string) {
    await this.service.removerMotivo(id);
    return { ok: true };
  }

  @Get('coordenadores')
  coordenadores() {
    return this.service.listarCoordenadores();
  }

  @Post('coordenadores')
  @HttpCode(201)
  criarCoordenador(@Body() dto: CriarCoordenadorDto, @Req() req: Request) {
    return this.service.criarCoordenador(dto, autor(req).id);
  }

  @Patch('coordenadores/:id')
  async atualizarCoordenador(
    @Param('id') id: string,
    @Body() dto: AtualizarCoordenadorDto,
  ) {
    await this.service.atualizarCoordenador(id, dto);
    return { ok: true };
  }

  @Delete('coordenadores/:id')
  @HttpCode(200)
  async removerCoordenador(@Param('id') id: string) {
    await this.service.removerCoordenador(id);
    return { ok: true };
  }
}
