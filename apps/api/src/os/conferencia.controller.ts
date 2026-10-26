import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConferenciaService } from './conferencia.service';
import { ConferirOsDto } from './dto/os.dto';

function quem(req: Request): { nome: string } {
  return { nome: (req.user as { nome?: string } | undefined)?.nome ?? 'alguém sem nome' };
}

/**
 * A conferência das OS fechadas — o chefe do almoxarifado olha, dia a dia, as
 * fotos, a assinatura e os aparelhos de cada OS, e diz se está certa.
 *
 * Mora no módulo Ordens de Serviço (o caminho começa com `os`, ver
 * `ModulosGuard`): quem confere precisa do módulo no login, e de um perfil que
 * grave — o Visualizador só olha.
 */
@Controller('os/conferencia')
export class ConferenciaController {
  constructor(private readonly conferencia: ConferenciaService) {}

  /** Os últimos dias, com quantas OS faltam conferir em cada um. */
  @Get()
  fila() {
    return this.conferencia.fila();
  }

  /** As OS de campo que fecharam num dia ("AAAA-MM-DD"), com os avisos. */
  @Get('dia/:dia')
  doDia(@Param('dia') dia: string) {
    return this.conferencia.doDia(dia);
  }

  /** As OS com problema ainda aberto, de qualquer dia. */
  @Get('problemas')
  problemas() {
    return this.conferencia.problemas();
  }

  /** As conferências do mês ("AAAA-MM"), por técnico e por motivo. */
  @Get('relatorio')
  relatorio(@Query('competencia') competencia = '') {
    return this.conferencia.relatorio(competencia);
  }

  /** Uma OS para conferir, lida agora do IXC. */
  @Get('os/:osId')
  daOs(@Param('osId', ParseIntPipe) osId: number) {
    return this.conferencia.daOs(osId);
  }

  @Post('os/:osId')
  @HttpCode(200)
  conferir(@Req() req: Request, @Param('osId', ParseIntPipe) osId: number, @Body() dto: ConferirOsDto) {
    return this.conferencia.conferir(osId, dto, quem(req));
  }

  /** A imagem de um arquivo da OS, do IXC. Não muda: o navegador pode guardar. */
  @Get('arquivos/:id')
  async arquivo(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { tipo, conteudo } = await this.conferencia.arquivo(id);
    res.set({
      'Content-Type': tipo,
      'Content-Length': String(conteudo.length),
      'Cache-Control': 'private, max-age=3600',
    });
    return new StreamableFile(conteudo);
  }
}
