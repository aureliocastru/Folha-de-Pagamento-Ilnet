import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ConfirmarNotaDto, RecusarNotaDto } from './dto/almoxarifado.dto';
import { NotasDeCompraService } from './notas-de-compra.service';

function quem(req: Request): { nome: string; id?: string } {
  const u = req.user as { nome?: string; id?: string } | undefined;
  return { nome: u?.nome ?? 'alguém sem nome', id: u?.id };
}

/**
 * O lado do Contas a Pagar das notas de compra: ver as que o almoxarife
 * lançou e decidir se as parcelas viram contas. O lançamento em si é do
 * almoxarifado (`almoxarifado/notas`); este prefixo é do módulo Contas a
 * Pagar na tabela do `ModulosGuard`.
 */
@Controller('notas-de-compra')
export class NotasDeCompraController {
  constructor(private readonly notas: NotasDeCompraService) {}

  @Get('pendentes')
  pendentes() {
    return this.notas.pendentes();
  }

  @Post(':id/confirmar')
  @HttpCode(200)
  confirmar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmarNotaDto,
    @Req() req: Request,
  ) {
    return this.notas.confirmar(id, dto, quem(req));
  }

  @Post(':id/recusar')
  @HttpCode(200)
  recusar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecusarNotaDto,
    @Req() req: Request,
  ) {
    return this.notas.recusar(id, dto.motivo, quem(req));
  }
}
