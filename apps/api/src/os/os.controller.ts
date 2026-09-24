import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ProdutosService } from '../almoxarifado/produtos.service';
import { ehAlmoxForaDaCasa } from '../almoxarifado/estoque.mapper';
import {
  ConferidoDto,
  EditarMaterialDto,
  FixarAlmoxDto,
  IncluirMaterialDto,
  ReceberRecolhidosDto,
} from './dto/os.dto';
import { MateriaisDeOsService } from './materiais.service';
import { OsService } from './os.service';
import { RecolhidosService } from './recolhidos.service';
import { RelatorioOsService } from './relatorio.service';
import { TecnicosService } from './tecnicos.service';

function quem(req: Request): { nome: string } {
  return { nome: (req.user as { nome?: string } | undefined)?.nome ?? 'alguém sem nome' };
}

/**
 * O módulo Ordens de Serviço — o lado da base.
 *
 * O técnico anota e grava pelo celular (`MinhasOsController`); daqui a base
 * acompanha: o que ficou pendente ou foi recusado pelo IXC, os aparelhos que
 * voltaram de cliente e precisam ser recebidos, o que está na van de cada
 * técnico, a lista de materiais e o relatório do mês.
 *
 * Quem abre é quem tem o módulo `os` (ver `ModulosGuard`); o Visualizador só
 * lê, como em todo módulo.
 */
@Controller('os')
export class OsController {
  constructor(
    private readonly os: OsService,
    private readonly recolhidos: RecolhidosService,
    private readonly tecnicos: TecnicosService,
    private readonly materiais: MateriaisDeOsService,
    private readonly relatorio: RelatorioOsService,
    private readonly produtos: ProdutosService,
  ) {}

  /** Os números que o menu mostra: o que espera alguém da base. */
  @Get('resumo')
  async resumo() {
    const [pendencias, recolhidos] = await Promise.all([
      this.os.registros({ pendencias: true, limite: 500 }),
      this.recolhidos.pendentes(),
    ]);
    return {
      comProblema: pendencias.filter((r) => r.problemas > 0).length,
      pendentes: pendencias.filter((r) => r.pendentes > 0).length,
      recolhidos: recolhidos.length,
    };
  }

  // --- As OS registradas ---

  @Get('registros')
  registros(@Query('pendencias') pendencias?: string, @Query('tecnico') tecnico?: string) {
    return this.os.registros({ pendencias: pendencias === '1', tecnicoId: tecnico || undefined });
  }

  /** Leva ao IXC o que ficou pendente numa OS. */
  @Post('registros/:id/gravar')
  @HttpCode(200)
  gravar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.os.gravarPelaBase(id, quem(req));
  }

  @Post('itens/:id/conferido')
  @HttpCode(200)
  conferido(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConferidoDto,
  ) {
    return this.os.resolverConferencia(id, dto, quem(req));
  }

  @Delete('itens/:id')
  @HttpCode(204)
  async descartar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.os.descartar(id, quem(req));
  }

  // --- Recolhidos ---

  @Get('recolhidos')
  pendentes() {
    return this.recolhidos.pendentes();
  }

  @Post('recolhidos/receber')
  @HttpCode(200)
  receber(@Req() req: Request, @Body() dto: ReceberRecolhidosDto) {
    return this.recolhidos.receber(dto, quem(req));
  }

  // --- Técnicos e as vans ---

  @Get('tecnicos')
  listaDeTecnicos(@Query('recarregar') recarregar?: string) {
    return this.tecnicos.lista(recarregar === '1');
  }

  @Get('tecnicos/:funcionarioId/van')
  van(@Param('funcionarioId', ParseUUIDPipe) funcionarioId: string) {
    return this.tecnicos.van(funcionarioId);
  }

  @Put('tecnicos/:funcionarioId/almox')
  fixar(
    @Req() req: Request,
    @Param('funcionarioId', ParseUUIDPipe) funcionarioId: string,
    @Body() dto: FixarAlmoxDto,
  ) {
    return this.tecnicos.fixar(funcionarioId, dto.almoxId, quem(req));
  }

  @Delete('tecnicos/:funcionarioId/almox')
  desfixar(@Req() req: Request, @Param('funcionarioId', ParseUUIDPipe) funcionarioId: string) {
    return this.tecnicos.desfixar(funcionarioId, quem(req));
  }

  /** Os almoxarifados que servem de van ou de destino: os que o sistema enxerga, ativos, da casa. */
  @Get('almoxarifados')
  async almoxarifados() {
    const [, almoxarifados] = await this.produtos.paraMovimentar();
    return almoxarifados
      .filter((a) => a.ativo && !ehAlmoxForaDaCasa(a.nome))
      .map(({ id, nome }) => ({ id, nome }));
  }

  // --- Materiais de OS ---

  @Get('materiais')
  listaDeMateriais() {
    return this.materiais.lista();
  }

  @Get('materiais/produtos')
  produtosParaIncluir(@Query('busca') busca = '', @Query('aparelho') aparelho?: string) {
    return this.materiais.produtosParaIncluir(busca, aparelho === '1');
  }

  @Post('materiais')
  @HttpCode(201)
  incluir(@Req() req: Request, @Body() dto: IncluirMaterialDto) {
    return this.materiais.incluir(dto, quem(req));
  }

  @Patch('materiais/:id')
  editar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EditarMaterialDto) {
    return this.materiais.editar(id, dto);
  }

  @Delete('materiais/:id')
  @HttpCode(204)
  async apagar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.materiais.apagar(id, quem(req));
  }

  // --- Relatório ---

  @Get('relatorio')
  doMes(@Query('competencia') competencia = '') {
    return this.relatorio.doMes(competencia);
  }
}
