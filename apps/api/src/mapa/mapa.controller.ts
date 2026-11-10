import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { VincularRastreadorDto } from './dto/mapa.dto';
import { MapaService } from './mapa.service';

/** O id do aparelho no rastreador: número, às vezes texto — nunca um caminho. */
function aparelho(id: string): string {
  const limpo = String(id ?? '').trim();
  if (!/^[\w.:-]{1,64}$/.test(limpo)) throw new BadRequestException('Aparelho do rastreador inválido.');
  return limpo;
}

function nomeDoUsuario(req: Request): string | null {
  return (req.user as { nome?: string } | undefined)?.nome ?? null;
}

/**
 * O mapa de serviço. Ler é para quem abre o módulo; ligar um rastreador a um
 * técnico segue a regra geral do `RolesGuard` (ADMIN e RH escrevem).
 */
@Controller('mapa')
export class MapaController {
  constructor(private readonly mapa: MapaService) {}

  @Get('config')
  config() {
    return this.mapa.configDaTela();
  }

  @Get('ordens')
  ordens() {
    return this.mapa.ordens();
  }

  @Get('frota')
  frota() {
    if (!this.mapa.temRastreador) {
      throw new ServiceUnavailableException(
        'O rastreamento não está configurado no servidor (RASTREIO_API_HASH, ou RASTREIO_EMAIL e RASTREIO_SENHA).',
      );
    }
    return this.mapa.frota();
  }

  @Get('rastreadores')
  rastreadores() {
    return this.mapa.rastreadores();
  }

  @Put('rastreadores/:dispositivoId')
  vincular(
    @Param('dispositivoId') dispositivoId: string,
    @Body() dto: VincularRastreadorDto,
    @Req() req: Request,
  ) {
    return this.mapa.vincular(aparelho(dispositivoId), dto, nomeDoUsuario(req));
  }

  @Delete('rastreadores/:dispositivoId')
  @HttpCode(204)
  async desvincular(@Param('dispositivoId') dispositivoId: string): Promise<void> {
    await this.mapa.desvincular(aparelho(dispositivoId));
  }
}
