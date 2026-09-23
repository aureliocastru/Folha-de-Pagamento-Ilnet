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
  AtualizarItemDeManutencaoDto,
  CriarItemDeManutencaoDto,
  RegistrarTrocaDto,
} from './dto/manutencao.dto';
import { ManutencaoService } from './manutencao.service';
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
    private readonly manutencao: ManutencaoService,
  ) {}

  /**
   * `?ativos=true` traz só os ligados — é a lista do "Lançar conta". Cada um
   * vem com quantas trocas estão vencidas ou perto: o selo da lista da frota.
   */
  @Get()
  async listar(@Query('ativos') ativos?: string) {
    const [veiculos, alertas] = await Promise.all([
      this.service.listar(ativos !== 'true'),
      this.manutencao.alertasDaFrota(),
    ]);
    return veiculos.map((v) => ({
      ...v,
      manutencao: alertas.get(v.id) ?? { vencidos: 0, perto: 0 },
    }));
  }

  /** Um item da manutenção mudado: nome, intervalo. Antes do `:id`. */
  @Patch('manutencao/:itemId')
  atualizarItemDeManutencao(
    @Param('itemId') itemId: string,
    @Body() dto: AtualizarItemDeManutencaoDto,
  ) {
    return this.manutencao.atualizarItem(itemId, dto);
  }

  @Delete('manutencao/:itemId')
  @HttpCode(200)
  async apagarItemDeManutencao(@Param('itemId') itemId: string) {
    await this.manutencao.apagarItem(itemId);
    return { ok: true };
  }

  /** "Troquei": o km e o dia da troca. */
  @Post('manutencao/:itemId/trocas')
  @HttpCode(201)
  registrarTroca(
    @Param('itemId') itemId: string,
    @Body() dto: RegistrarTrocaDto,
    @Req() req: Request,
  ) {
    return this.manutencao.registrarTroca(itemId, dto, usuarioId(req));
  }

  @Delete('manutencao/trocas/:trocaId')
  @HttpCode(200)
  async desfazerTroca(@Param('trocaId') trocaId: string) {
    await this.manutencao.desfazerTroca(trocaId);
    return { ok: true };
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
    return this.abastecimentos.conferir(id, dto.valor, nomeDe(req), dto.litros);
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

  /** A manutenção do veículo: o que se troca, e quanto falta para cada um. */
  @Get(':id/manutencao')
  manutencaoDoVeiculo(@Param('id') id: string) {
    return this.manutencao.doVeiculo(id);
  }

  @Post(':id/manutencao')
  @HttpCode(201)
  criarItemDeManutencao(@Param('id') id: string, @Body() dto: CriarItemDeManutencaoDto) {
    return this.manutencao.criarItem(id, dto);
  }

  /** Traz de volta o que falta da lista padrão do tipo. */
  @Post(':id/manutencao/padrao')
  @HttpCode(200)
  async completarManutencao(@Param('id') id: string) {
    return { adicionados: await this.manutencao.completarComPadrao(id) };
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
