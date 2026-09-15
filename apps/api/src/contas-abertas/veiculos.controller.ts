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
import { AbastecimentosService } from './abastecimentos.service';
import {
  AtualizarVeiculoDto,
  ConferirAbastecimentoDto,
  CriarVeiculoDto,
  LancarAbastecimentoNoSistemaDto,
} from './dto/veiculo.dto';
import { VeiculosService } from './veiculos.service';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

function nomeDe(req: Request): string {
  return (req.user as { nome?: string } | undefined)?.nome ?? 'Sistema';
}

/** Os veículos da frota, o que cada um já custou e os abastecimentos. */
@Controller('veiculos')
export class VeiculosController {
  constructor(
    private readonly service: VeiculosService,
    private readonly abastecimentos: AbastecimentosService,
  ) {}

  /** `?ativos=true` traz só os ligados — é a lista do "Lançar conta". */
  @Get()
  listar(@Query('ativos') ativos?: string) {
    return this.service.listar(ativos !== 'true');
  }

  /** Quem pode ficar responsável por um veículo. Antes do `:id`. */
  @Get('responsaveis')
  responsaveis() {
    return this.service.responsaveis();
  }

  /** A fila da conferência: abastecimentos de todos os veículos sem valor. */
  @Get('abastecimentos/a-conferir')
  aConferir() {
    return this.abastecimentos.aConferir();
  }

  /** A foto da nota de um abastecimento. Antes do `:id`. */
  @Get('abastecimentos/:id/foto')
  fotoDoAbastecimento(@Param('id') id: string) {
    return this.abastecimentos.foto(id);
  }

  /** O valor lido na nota. Só controle: nada se paga por aqui. */
  @Patch('abastecimentos/:id')
  conferir(
    @Param('id') id: string,
    @Body() dto: ConferirAbastecimentoDto,
    @Req() req: Request,
  ) {
    return this.abastecimentos.conferir(id, dto.valor, nomeDe(req));
  }

  /** Lançar um abastecimento pela ficha do veículo. */
  @Post(':id/abastecimentos')
  @HttpCode(201)
  lancarAbastecimento(
    @Param('id') id: string,
    @Body() dto: LancarAbastecimentoNoSistemaDto,
    @Req() req: Request,
  ) {
    return this.abastecimentos.lancarPeloSistema(id, dto, {
      id: usuarioId(req),
      nome: nomeDe(req),
    });
  }

  @Delete('abastecimentos/:id')
  @HttpCode(200)
  async apagarAbastecimento(@Param('id') id: string) {
    await this.abastecimentos.apagar(id);
    return { ok: true };
  }

  /** O veículo com cada gasto, a soma por categoria e os abastecimentos. */
  @Get(':id')
  ficha(@Param('id') id: string) {
    return this.service.ficha(id);
  }

  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarVeiculoDto, @Req() req: Request) {
    return this.service.criar(dto, usuarioId(req));
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarVeiculoDto) {
    return this.service.atualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.service.remover(id);
    return { ok: true };
  }
}
