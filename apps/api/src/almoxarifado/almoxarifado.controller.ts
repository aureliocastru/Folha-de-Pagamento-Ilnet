import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AlmoxarifadosService } from './almoxarifados.service';
import { ComodatoService } from './comodato.service';
import {
  AtualizarFerramentaDto,
  CriarAlmoxarifadoDto,
  CriarFerramentaDto,
  CriarProdutoDto,
  DevolverDto,
  EditarAlmoxarifadoDto,
  EditarProdutoDto,
  EmprestarDto,
  EntradaDeCompraDto,
  TransferirProdutoDto,
} from './dto/almoxarifado.dto';
import { EstoqueService } from './estoque.service';
import { FerramentasService } from './ferramentas.service';
import { ProdutosService } from './produtos.service';

/** `?x=1`, `?x=true` — tudo o que uma tela manda como "sim". */
function ehSim(valor?: string): boolean {
  return valor === '1' || valor === 'true' || valor === 'sim';
}

function nomeDoLogado(req: Request): string | undefined {
  return (req.user as { nome?: string } | undefined)?.nome;
}

/** Quem está mexendo no IXC — vai para o log e para a observação da transferência. */
function quem(req: Request): { nome: string } {
  return { nome: nomeDoLogado(req) ?? 'alguém sem nome' };
}

/**
 * O almoxarifado: o estoque de material e o caderno de ferramentas.
 *
 * Duas metades com naturezas diferentes, e vale saber qual é qual antes de
 * mexer aqui:
 *
 * - **O estoque é do IXC.** O que se muda aqui — cadastro de produto,
 *   transferência entre almoxarifados, entrada de compra — é escrito lá, e só
 *   lá, pelos caminhos que a API do IXC documenta (ver `ProdutosService`).
 *   Nenhum saldo mora nesta casa: dois saldos para a mesma prateleira não
 *   teriam como dizer qual está certo. O comodato também é de lá, e aqui só se
 *   lê.
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
    private readonly produtos: ProdutosService,
    private readonly comodato: ComodatoService,
    private readonly almoxarifados: AlmoxarifadosService,
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
  // Produtos — escritos no IXC
  // -------------------------------------------------------------------------

  /** Unidades, almoxarifados, tipos de documento e condições de pagamento do IXC. */
  @Get('produtos/opcoes')
  opcoesDosProdutos() {
    return this.produtos.opcoes();
  }

  /** Fornecedores do IXC para a entrada de compra. Só leitura. */
  @Get('fornecedores')
  fornecedores(@Query('busca') busca?: string) {
    return this.produtos.buscarFornecedores(busca ?? '');
  }

  @Get('produtos/:id')
  produto(@Param('id', ParseIntPipe) id: number) {
    return this.produtos.detalhar(id);
  }

  @Post('produtos')
  @HttpCode(201)
  criarProduto(@Body() dto: CriarProdutoDto, @Req() req: Request) {
    return this.produtos.criar(dto, quem(req));
  }

  @Patch('produtos/:id')
  editarProduto(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditarProdutoDto,
    @Req() req: Request,
  ) {
    return this.produtos.editar(id, dto, quem(req));
  }

  @Delete('produtos/:id')
  @HttpCode(204)
  async apagarProduto(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    await this.produtos.apagar(id, quem(req));
  }

  @Post('produtos/:id/transferir')
  @HttpCode(200)
  transferir(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransferirProdutoDto,
    @Req() req: Request,
  ) {
    return this.produtos.transferir(id, dto, quem(req));
  }

  @Post('produtos/:id/entrada')
  @HttpCode(200)
  darEntrada(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EntradaDeCompraDto,
    @Req() req: Request,
  ) {
    return this.produtos.darEntrada(id, dto, quem(req));
  }

  // -------------------------------------------------------------------------
  // Comodato — lido do IXC
  // -------------------------------------------------------------------------

  @Get('comodatos')
  comodatos(@Query('recarregar') recarregar?: string) {
    return this.comodato.listar(ehSim(recarregar));
  }

  // -------------------------------------------------------------------------
  // Almoxarifados — cadastro (a tabela `almox`), escrito no IXC
  // -------------------------------------------------------------------------

  @Get('almoxarifados')
  listarAlmoxarifados() {
    return this.almoxarifados.listar();
  }

  /** As filiais do IXC, para o formulário de cadastro. */
  @Get('almoxarifados/opcoes')
  opcoesDosAlmoxarifados() {
    return this.almoxarifados.opcoes();
  }

  @Post('almoxarifados')
  @HttpCode(201)
  criarAlmoxarifado(@Body() dto: CriarAlmoxarifadoDto, @Req() req: Request) {
    return this.almoxarifados.criar(dto, quem(req));
  }

  @Patch('almoxarifados/:id')
  editarAlmoxarifado(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditarAlmoxarifadoDto,
    @Req() req: Request,
  ) {
    return this.almoxarifados.editar(id, dto, quem(req));
  }

  @Delete('almoxarifados/:id')
  @HttpCode(204)
  async apagarAlmoxarifado(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    await this.almoxarifados.apagar(id, quem(req));
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
