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
import { CotacoesService } from './cotacoes.service';
import {
  AtualizarFornecedorDto,
  AtualizarPrecoDto,
  AtualizarProdutoDto,
  CriarFornecedorDto,
  CriarPrecoDto,
  CriarProdutoDto,
} from './dto/cotacoes.dto';
import { FornecedoresCotacaoService } from './fornecedores-cotacao.service';

/** `?inativos=1`, `?inativos=true` — tudo o que uma tela manda como "sim". */
function ehSim(valor?: string): boolean {
  return valor === '1' || valor === 'true' || valor === 'sim';
}

/** O nome de quem está logado, para assinar a cotação. */
function nomeDoLogado(req: Request): string | undefined {
  return (req.user as { nome?: string } | undefined)?.nome;
}

/**
 * Cotações de preços — o módulo inteiro numa porta só.
 *
 * O prefixo é um só (`/api/cotacoes/...`) de propósito: o `ModulosGuard` decide
 * o acesso pelo primeiro pedaço do caminho, e assim uma rota nova daqui nasce
 * coberta sem ninguém ter de lembrar de cadastrá-la lá.
 *
 * Não há `@Roles` nenhum: valem as regras gerais da casa. ADMIN e RH escrevem,
 * VISUALIZADOR lê — o `RolesGuard` recusa a escrita dele sozinho —, e quem abre
 * o módulo é assunto da lista de módulos do login.
 */
@Controller('cotacoes')
export class CotacoesController {
  constructor(
    private readonly cotacoes: CotacoesService,
    private readonly fornecedores: FornecedoresCotacaoService,
  ) {}

  // -------------------------------------------------------------------------
  // Fornecedores — antes dos produtos por clareza, e sem conflito de rota
  // -------------------------------------------------------------------------

  @Get('fornecedores')
  listarFornecedores(
    @Query('busca') busca?: string,
    @Query('inativos') inativos?: string,
  ) {
    return this.fornecedores.listar({
      busca,
      incluirInativos: ehSim(inativos),
    });
  }

  @Post('fornecedores')
  @HttpCode(201)
  criarFornecedor(@Body() dto: CriarFornecedorDto) {
    return this.fornecedores.criar(dto);
  }

  @Patch('fornecedores/:id')
  atualizarFornecedor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarFornecedorDto,
  ) {
    return this.fornecedores.atualizar(id, dto);
  }

  @Delete('fornecedores/:id')
  @HttpCode(204)
  async excluirFornecedor(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('comAsCotacoes') comAsCotacoes?: string,
  ) {
    await this.fornecedores.excluir(id, ehSim(comAsCotacoes));
  }

  // -------------------------------------------------------------------------
  // Preços. Antes de `produtos/:id` não é preciso — o prefixo é outro —, mas
  // ficam juntos porque toda escrita aqui devolve o produto recalculado.
  // -------------------------------------------------------------------------

  @Post('precos')
  @HttpCode(201)
  criarPreco(@Body() dto: CriarPrecoDto, @Req() req: Request) {
    return this.cotacoes.criarPreco(dto, nomeDoLogado(req));
  }

  @Patch('precos/:id')
  atualizarPreco(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarPrecoDto,
  ) {
    return this.cotacoes.atualizarPreco(id, dto);
  }

  @Delete('precos/:id')
  excluirPreco(@Param('id', ParseUUIDPipe) id: string) {
    // Devolve o produto recalculado, e não 204: apagar a cotação mais recente
    // muda quem é o mais barato, e a tela precisa do novo campeão na resposta.
    return this.cotacoes.excluirPreco(id);
  }

  // -------------------------------------------------------------------------
  // Produtos
  // -------------------------------------------------------------------------

  @Get('produtos')
  listarProdutos(
    @Query('busca') busca?: string,
    @Query('inativos') inativos?: string,
  ) {
    return this.cotacoes.listarProdutos({
      busca,
      incluirInativos: ehSim(inativos),
    });
  }

  @Get('produtos/:id')
  detalharProduto(@Param('id', ParseUUIDPipe) id: string) {
    return this.cotacoes.detalharProduto(id);
  }

  @Post('produtos')
  @HttpCode(201)
  criarProduto(@Body() dto: CriarProdutoDto) {
    return this.cotacoes.criarProduto(dto);
  }

  @Patch('produtos/:id')
  atualizarProduto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarProdutoDto,
  ) {
    return this.cotacoes.atualizarProduto(id, dto);
  }

  @Delete('produtos/:id')
  @HttpCode(204)
  async excluirProduto(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('comAsCotacoes') comAsCotacoes?: string,
  ) {
    await this.cotacoes.excluirProduto(id, ehSim(comAsCotacoes));
  }
}
