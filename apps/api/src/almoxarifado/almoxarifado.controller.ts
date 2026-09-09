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
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AtualizarFerramentaDto,
  CriarFerramentaDto,
  DevolverDto,
  EmprestarDto,
} from './dto/almoxarifado.dto';
import { EstoqueService } from './estoque.service';
import { FerramentasService } from './ferramentas.service';

/** `?x=1`, `?x=true` — tudo o que uma tela manda como "sim". */
function ehSim(valor?: string): boolean {
  return valor === '1' || valor === 'true' || valor === 'sim';
}

function nomeDoLogado(req: Request): string | undefined {
  return (req.user as { nome?: string } | undefined)?.nome;
}

/**
 * O almoxarifado: o estoque de material e o caderno de ferramentas.
 *
 * Duas metades com naturezas diferentes, e vale saber qual é qual antes de
 * mexer aqui:
 *
 * - **O estoque é do IXC, e só se lê.** Ele já é controlado lá, com entrada de
 *   compra, ordem de serviço e transferência entre almoxarifados. Um segundo
 *   lugar que também escrevesse criaria dois saldos para a mesma prateleira e
 *   nenhum jeito de saber qual está certo. O que esta tela faz é o que o IXC
 *   faz mal: responder de relance "o que está acabando?" e "onde tem?".
 * - **A ferramenta é daqui, e se escreve.** O IXC não tem onde guardar "quem
 *   está com a máquina de fusão": o que existe lá é comodato de cliente e
 *   produto consumido em OS, e nenhum dos dois é a chave de fenda que o técnico
 *   levou na sexta.
 */
@Controller('almoxarifado')
export class AlmoxarifadoController {
  constructor(
    private readonly estoque: EstoqueService,
    private readonly ferramentas: FerramentasService,
  ) {}

  // -------------------------------------------------------------------------
  // Estoque — leitura do IXC
  // -------------------------------------------------------------------------

  @Get('estoque')
  listarEstoque(
    @Query('busca') busca?: string,
    @Query('almox') almox?: string,
    @Query('faltando') faltando?: string,
    @Query('recarregar') recarregar?: string,
  ) {
    const almoxId = Number(almox);
    return this.estoque.listar({
      busca,
      almoxId: Number.isFinite(almoxId) && almoxId > 0 ? almoxId : undefined,
      soFaltando: ehSim(faltando),
      recarregar: ehSim(recarregar),
    });
  }

  // -------------------------------------------------------------------------
  // Ferramentas — o caderno desta casa
  // -------------------------------------------------------------------------

  @Get('ferramentas')
  listarFerramentas(
    @Query('busca') busca?: string,
    @Query('baixadas') baixadas?: string,
    @Query('emprestadas') emprestadas?: string,
  ) {
    return this.ferramentas.listar({
      busca,
      incluirBaixadas: ehSim(baixadas),
      soEmprestadas: ehSim(emprestadas),
    });
  }

  /** Os nomes de quem pode levar uma ferramenta. Só id, nome e apelido. */
  @Get('pessoas')
  pessoas() {
    return this.ferramentas.pessoas();
  }

  @Get('ferramentas/:id/historico')
  historico(@Param('id', ParseUUIDPipe) id: string) {
    return this.ferramentas.historico(id);
  }

  @Post('ferramentas')
  @HttpCode(201)
  criar(@Body() dto: CriarFerramentaDto) {
    return this.ferramentas.criar(dto);
  }

  @Patch('ferramentas/:id')
  atualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarFerramentaDto,
  ) {
    return this.ferramentas.atualizar(id, dto);
  }

  @Delete('ferramentas/:id')
  @HttpCode(204)
  async excluir(@Param('id', ParseUUIDPipe) id: string) {
    await this.ferramentas.excluir(id);
  }

  /** Entrega a ferramenta. Devolve a ferramenta inteira: quem a pegou mudou. */
  @Post('ferramentas/:id/emprestar')
  emprestar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EmprestarDto,
    @Req() req: Request,
  ) {
    return this.ferramentas.emprestar(id, dto, nomeDoLogado(req));
  }

  @Post('ferramentas/:id/devolver')
  devolver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DevolverDto,
    @Req() req: Request,
  ) {
    return this.ferramentas.devolver(id, dto, nomeDoLogado(req));
  }
}
