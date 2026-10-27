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
import type { Request } from 'express';
import { DiaristasService } from './diaristas.service';
import {
  LoteDiariasDto,
  PagarDiariaDto,
  QueryDiariasDto,
} from './dto/diaria.dto';
import { CriarDiaristaDto, UpdateDiaristaDto } from './dto/diarista.dto';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

@Controller('diaristas')
export class DiaristasController {
  constructor(private readonly service: DiaristasService) {}

  @Get()
  listar(@Query('busca') busca?: string, @Query('todos') todos?: string) {
    return this.service.listar(busca, todos === 'true');
  }

  // Rotas de diária antes de ":id" para "diarias" não ser lido como um id.
  @Get('diarias')
  listarDiarias(@Query() q: QueryDiariasDto) {
    return this.service.listarDiarias(q.diaristaId);
  }

  /** As que ficaram no meio do caminho e não vão sair sozinhas. */
  @Get('diarias/travadas')
  listarTravadas() {
    return this.service.listarTravadas();
  }

  /** Pagamentos em mãos cujo recibo ninguém assinou ainda. */
  @Get('diarias/aguardando-assinatura')
  listarAguardandoAssinatura() {
    return this.service.listarAguardandoAssinatura();
  }

  @Post('diarias/excluir-lote')
  @HttpCode(200)
  excluirLote(@Body() dto: LoteDiariasDto) {
    return this.service.removerDiarias(dto.ids);
  }

  /** Tenta de novo a saída no caixa do IXC. */
  @Post('diarias/:id/lancar-caixa')
  @HttpCode(200)
  lancarCaixa(@Param('id') id: string) {
    return this.service.lancarNoCaixa(id);
  }

  /** Recibo assinado e a baixa não saiu: tenta de novo. */
  @Post('diarias/:id/quitar')
  @HttpCode(200)
  quitar(@Param('id') id: string) {
    return this.service.quitarAposAssinatura(id);
  }

  /** Alguém lançou no IXC à mão: fecha a pendência. */
  @Post('diarias/:id/marcar-lancado')
  @HttpCode(200)
  marcarLancado(@Param('id') id: string) {
    return this.service.marcarLancadoManual(id);
  }

  @Delete('diarias/:id')
  @HttpCode(200)
  async removerDiaria(@Param('id') id: string) {
    await this.service.removerDiaria(id);
    return { ok: true };
  }

  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarDiaristaDto) {
    return this.service.criar(dto);
  }

  @Get(':id')
  buscar(@Param('id') id: string) {
    return this.service.buscar(id);
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: UpdateDiaristaDto) {
    return this.service.atualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.service.remover(id);
    return { ok: true };
  }

  /** Paga uma diária: conta a pagar no IXC ou saída do caixa. */
  @Post(':id/diarias')
  @HttpCode(201)
  pagar(
    @Param('id') id: string,
    @Body() dto: PagarDiariaDto,
    @Req() req: Request,
  ) {
    return this.service.pagar(id, dto, usuarioId(req));
  }
}
