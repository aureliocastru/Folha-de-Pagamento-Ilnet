import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import {
  AnexarAssinaturaDto,
  AnexarFotoDto,
  AnotarItemDto,
  AnotarRetiradasDto,
  FinalizarDto,
  ResponderConferenciaDto,
} from './dto/os.dto';
import { ConferenciaService } from './conferencia.service';
import { FinalizacaoService } from './finalizacao.service';
import { OsService, type Login } from './os.service';

/**
 * As ordens de serviço do técnico, no celular: as OS dele no IXC, o que ele
 * instala, retira e gasta em cada uma, e a finalização.
 *
 * Como a tela do colaborador, isto é **da pessoa que entrou** — nada aqui
 * recebe o técnico de fora. Quem ele é sai do login; quais OS são dele, do
 * `id_tecnico` do IXC (ver `OsService.contexto`). Por isso mora fora dos
 * módulos do `ModulosGuard`: o técnico de campo não abre módulo nenhum além da
 * Segurança do Trabalho, e esta tela é dele mesmo assim.
 *
 * O que decide quem entra é a marca "Ordens de serviço" da Minha área, dada
 * pelo administrador login a login (o técnico de campo já nasce com ela). A
 * lista de perfis é exaustiva pelo mesmo motivo da tela do colaborador: um
 * perfil novo não entra por omissão.
 */
@Roles(UserRole.ADMIN, UserRole.RH, UserRole.VISUALIZADOR, UserRole.TECNICO)
@Controller('minhas-os')
export class MinhasOsController {
  constructor(
    private readonly os: OsService,
    private readonly finalizacao: FinalizacaoService,
    private readonly conferencia: ConferenciaService,
  ) {}

  @Get()
  minhas(@Req() req: Request) {
    return this.os.minhas(logado(req));
  }

  // A conferência vem antes de `:osId`: o Express casa as rotas na ordem, e
  // "conferencia" iria parar no número da OS.

  /** As OS deste técnico que voltaram da conferência do almoxarifado com problema. */
  @Get('conferencia')
  voltaramDaConferencia(@Req() req: Request) {
    return this.conferencia.doTecnico(logado(req));
  }

  /** O técnico responde o problema da conferência. */
  @Post('conferencia/:osId/resposta')
  @HttpCode(200)
  responderConferencia(
    @Req() req: Request,
    @Param('osId', ParseIntPipe) osId: number,
    @Body() dto: ResponderConferenciaDto,
  ) {
    return this.conferencia.responder(logado(req), osId, dto.texto);
  }

  @Get(':osId')
  abrir(@Req() req: Request, @Param('osId', ParseIntPipe) osId: number) {
    return this.os.abrir(logado(req), osId);
  }

  /** O aparelho de um código bipado, e se ele pode ser instalado. Não anota nada. */
  @Get(':osId/aparelho')
  aparelho(
    @Req() req: Request,
    @Param('osId', ParseIntPipe) osId: number,
    @Query('codigo') codigo = '',
  ) {
    return this.os.procurarAparelho(logado(req), osId, codigo);
  }

  @Post(':osId/itens')
  @HttpCode(201)
  anotar(
    @Req() req: Request,
    @Param('osId', ParseIntPipe) osId: number,
    @Body() dto: AnotarItemDto,
  ) {
    return this.os.anotar(logado(req), osId, dto);
  }

  /** Vários aparelhos retirados de uma vez, todos na mesma condição. */
  @Post(':osId/retiradas')
  @HttpCode(201)
  anotarRetiradas(
    @Req() req: Request,
    @Param('osId', ParseIntPipe) osId: number,
    @Body() dto: AnotarRetiradasDto,
  ) {
    return this.os.anotarRetiradas(logado(req), osId, dto);
  }

  @Delete(':osId/itens/:itemId')
  @HttpCode(204)
  async tirar(
    @Req() req: Request,
    @Param('osId', ParseIntPipe) osId: number,
    @Param('itemId') itemId: string,
  ) {
    await this.os.tirar(logado(req), osId, itemId);
  }

  @Post(':osId/gravar')
  @HttpCode(200)
  gravar(@Req() req: Request, @Param('osId', ParseIntPipe) osId: number) {
    return this.os.gravar(logado(req), osId);
  }

  /** O que o passo a passo de finalizar mostra: as listas e o que o assunto pede. */
  @Get(':osId/finalizar')
  paraFinalizar(@Req() req: Request, @Param('osId', ParseIntPipe) osId: number) {
    return this.finalizacao.paraFinalizar(logado(req), osId);
  }

  /** O que está na aba "Arquivos" da OS, no IXC. */
  @Get(':osId/arquivos')
  arquivos(@Req() req: Request, @Param('osId', ParseIntPipe) osId: number) {
    return this.finalizacao.arquivos(logado(req), osId);
  }

  /** Anexa uma foto direto na aba "Arquivos" da OS no IXC. Nada fica guardado aqui. */
  @Post(':osId/fotos')
  @HttpCode(201)
  anexarFoto(
    @Req() req: Request,
    @Param('osId', ParseIntPipe) osId: number,
    @Body() dto: AnexarFotoDto,
  ) {
    return this.finalizacao.anexarFoto(logado(req), osId, dto);
  }

  /** Anexa a assinatura do cliente direto na aba "Arquivos" da OS no IXC. */
  @Post(':osId/assinatura')
  @HttpCode(201)
  anexarAssinatura(
    @Req() req: Request,
    @Param('osId', ParseIntPipe) osId: number,
    @Body() dto: AnexarAssinaturaDto,
  ) {
    return this.finalizacao.anexarAssinatura(logado(req), osId, dto);
  }

  /** Finaliza a OS no IXC — depois de levar o que ficou anotado. */
  @Post(':osId/finalizar')
  @HttpCode(200)
  finalizar(
    @Req() req: Request,
    @Param('osId', ParseIntPipe) osId: number,
    @Body() dto: FinalizarDto,
  ) {
    return this.finalizacao.finalizar(logado(req), osId, dto);
  }
}

/**
 * O login que entrou — e só se ele abre as OS. A marca é da Minha área
 * (`minhaArea`), relida do banco a cada pedido pelo `JwtStrategy`: tirar a
 * marca de alguém vale no clique seguinte.
 */
function logado(req: Request): Login {
  const usuario = req.user as { id: string; nome: string; minhaArea?: string[] };
  if (!(usuario.minhaArea ?? []).includes('os')) {
    throw new ForbiddenException(
      'Seu login não abre "Ordens de serviço". Peça ao administrador para marcar, nos módulos do seu login.',
    );
  }
  return { id: usuario.id, nome: usuario.nome };
}
