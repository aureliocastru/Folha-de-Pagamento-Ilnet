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
import { AcertoDeNegativosService } from './acerto-negativos.service';
import { AlmoxarifadosService } from './almoxarifados.service';
import { ComodatoService } from './comodato.service';
import {
  AcertoDeNegativosDto,
  AtualizarFerramentaDto,
  CriarAlmoxarifadoDto,
  CriarFerramentaDto,
  CriarProdutoDto,
  DevolverDto,
  EditarAlmoxarifadoDto,
  EditarProdutoDto,
  EmprestarDto,
  EntradaDeCompraDto,
  LigarUsuarioDto,
  MoverTudoDto,
  PadraoDoUsuarioDto,
  TransferenciaDto,
  TransferirProdutoDto,
} from './dto/almoxarifado.dto';
import { EstoqueService } from './estoque.service';
import { FerramentasService } from './ferramentas.service';
import { ProdutosService } from './produtos.service';
import { TransferenciasService } from './transferencias.service';

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
    private readonly transferencias: TransferenciasService,
    private readonly acerto: AcertoDeNegativosService,
  ) {}

  // -------------------------------------------------------------------------
  // Estoque — leitura do IXC
  // -------------------------------------------------------------------------

  @Get('estoque')
  listarEstoque(
    @Query('busca') busca?: string,
    @Query('almox') almox?: string,
    @Query('recarregar') recarregar?: string,
  ) {
    const almoxId = Number(almox);
    return this.estoque.listar({
      busca,
      almoxId: Number.isFinite(almoxId) && almoxId > 0 ? almoxId : undefined,
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

  /** Os movimentos do produto num almoxarifado, crus do IXC — a matéria do rastreio. */
  @Get('produtos/:id/movimentos')
  movimentosDoProduto(
    @Param('id', ParseIntPipe) id: number,
    @Query('almox', ParseIntPipe) almox: number,
  ) {
    return this.produtos.movimentosCrus(id, almox);
  }

  /** As compras abertas do fornecedor — as de acerto que ainda se podem desfazer. */
  @Get('entradas/abertas')
  entradasAbertas(@Query('fornecedor', ParseIntPipe) fornecedor: number) {
    return this.produtos.entradasAbertasDoFornecedor(fornecedor);
  }

  /** A última compra do fornecedor — o modelo (tipo de documento, condição) da compra de acerto. */
  @Get('entradas/ultima')
  ultimaEntrada(@Query('fornecedor', ParseIntPipe) fornecedor: number) {
    return this.produtos.ultimaEntradaDoFornecedor(fornecedor);
  }

  /** Uma compra do IXC, crua (cabeçalho e itens) — para comparar com a que o sistema monta. */
  @Get('entradas/:id')
  entradaCrua(@Param('id', ParseIntPipe) id: number) {
    return this.produtos.entradaCrua(id);
  }

  /** Em qual movimento o saldo ficou negativo — a saída, a transferência, a OS. */
  @Get('produtos/:id/rastreio')
  rastreioDoNegativo(
    @Param('id', ParseIntPipe) id: number,
    @Query('almox', ParseIntPipe) almox: number,
  ) {
    return this.produtos.rastreio(id, almox);
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
  // Acerto dos saldos negativos — compra de acerto no IXC
  // -------------------------------------------------------------------------

  /** Os negativos de agora: o que o acerto zera e o que fica, com o porquê. */
  @Get('negativos')
  negativos() {
    return this.acerto.listar();
  }

  /** Lança a compra de acerto com os marcados. Volta na hora; roda em segundo plano. */
  @Post('negativos/acertar')
  @HttpCode(202)
  acertarNegativos(@Body() dto: AcertoDeNegativosDto, @Req() req: Request) {
    return this.acerto.iniciar(dto, quem(req));
  }

  @Get('negativos/acertos/:id')
  andamentoDoAcerto(@Param('id', ParseUUIDPipe) id: string) {
    return this.acerto.andamento(id);
  }

  /** Desfaz uma compra de acerto aberta: apaga os itens e a compra. Roda em segundo plano. */
  @Post('negativos/desfazer/:entradaId')
  @HttpCode(202)
  desfazerAcerto(@Param('entradaId', ParseIntPipe) entradaId: number, @Req() req: Request) {
    return this.acerto.desfazer(entradaId, quem(req));
  }

  @Get('negativos/desfazimentos/:id')
  andamentoDoDesfazimento(@Param('id', ParseUUIDPipe) id: string) {
    return this.acerto.desfazimento(id);
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

  /**
   * Liga o usuário do IXC do sistema aos almoxarifados que ele não enxerga
   * (os de técnico). Só acrescenta ligação; não tira nem troca o padrão.
   */
  @Post('almoxarifados/liberar')
  @HttpCode(200)
  liberarAlmoxarifados(@Req() req: Request) {
    return this.almoxarifados.liberar(quem(req));
  }

  /**
   * Liga um usuário do IXC a este almoxarifado — é o que o faz enxergá-lo, lá
   * e na API. `padrao` marca este como o almoxarifado de onde a OS dele sai.
   */
  @Post('almoxarifados/:id/usuarios')
  @HttpCode(201)
  ligarUsuarioNoAlmoxarifado(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LigarUsuarioDto,
    @Req() req: Request,
  ) {
    return this.almoxarifados.ligarUsuario(id, dto.usuarioId, dto.padrao === true, quem(req));
  }

  /** Marca/desmarca este almoxarifado como o padrão do usuário (o padrão é um por pessoa). */
  @Patch('almoxarifados/:id/usuarios/:usuarioId')
  padraoDoUsuarioNoAlmoxarifado(
    @Param('id', ParseIntPipe) id: number,
    @Param('usuarioId', ParseIntPipe) usuarioId: number,
    @Body() dto: PadraoDoUsuarioDto,
    @Req() req: Request,
  ) {
    return this.almoxarifados.definirPadrao(id, usuarioId, dto.padrao, quem(req));
  }

  /** Tira a ligação: a pessoa deixa de enxergar este almoxarifado no IXC. */
  @Delete('almoxarifados/:id/usuarios/:usuarioId')
  desligarUsuarioDoAlmoxarifado(
    @Param('id', ParseIntPipe) id: number,
    @Param('usuarioId', ParseIntPipe) usuarioId: number,
    @Req() req: Request,
  ) {
    return this.almoxarifados.desligarUsuario(id, usuarioId, quem(req));
  }

  /**
   * O que o almoxarifado tem agora, lido do IXC: produtos por quantidade e
   * patrimônios peça por peça (com MAC e número) — o que dá para transferir.
   */
  @Get('almoxarifados/:id/conteudo')
  conteudoDoAlmoxarifado(@Param('id', ParseIntPipe) id: number) {
    return this.transferencias.conteudo(id);
  }

  /**
   * Leva tudo do almoxarifado para outro, numa transferência do IXC —
   * patrimônio incluso, peça por peça. Volta na hora com o andamento.
   */
  @Post('almoxarifados/:id/mover-tudo')
  @HttpCode(202)
  moverTudo(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoverTudoDto,
    @Req() req: Request,
  ) {
    return this.transferencias.iniciar({ de: id, ...dto, tudo: true }, quem(req));
  }

  // -------------------------------------------------------------------------
  // Transferência de vários itens — produto e patrimônio, escrita no IXC
  // -------------------------------------------------------------------------

  /** Abre a transferência com a lista escolhida. Volta na hora; roda em segundo plano. */
  @Post('transferencias')
  @HttpCode(202)
  transferirVarios(@Body() dto: TransferenciaDto, @Req() req: Request) {
    return this.transferencias.iniciar(dto, quem(req));
  }

  @Get('transferencias/:id')
  andamentoDaTransferencia(@Param('id', ParseUUIDPipe) id: string) {
    return this.transferencias.andamento(id);
  }

  /** Uma transferência nova com o que a terminada não conseguiu levar. */
  @Post('transferencias/:id/repetir')
  @HttpCode(202)
  repetirTransferencia(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.transferencias.repetir(id, quem(req));
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
