import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { ConfiguracaoService } from './configuracao-tela.service';
import { DiagnosticoService, type PedidoDeDiagnostico } from './diagnostico.service';
import {
  AbrirPacoteDto,
  ConfiguracaoDto,
  EncerrarContratoDto,
  EnviarArquivoDto,
  LancarTarifaDto,
  LerDeNovoDto,
  MarcarDto,
  MarcarVariosDto,
} from './dto/contabilidade.dto';
import { ExtratoDoBancoService } from './extrato-do-banco.service';
import { PacoteZipService } from './pacote-zip.service';
import { PacoteContabilService } from './pacote.service';
import { TarifasDoBancoService } from './tarifas.service';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/** O nome nas duas formas: a simples para cliente velho, a `filename*` para o acento. */
function disposicao(tipo: 'inline' | 'attachment', nome: string): string {
  const simples = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `${tipo}; filename="${simples}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

/**
 * Contabilidade — o pacote do mês que vai para o escritório de contabilidade.
 *
 * Só ADMIN: o que passa por aqui é o extrato de todas as contas, o que cada
 * cliente deve e quanto os sócios retiraram. Não é assunto de perfil nenhum
 * além de quem responde pela empresa.
 */
@Roles(UserRole.ADMIN)
@Controller('contabilidade')
export class ContabilidadeController {
  constructor(
    private readonly diagnostico: DiagnosticoService,
    private readonly pacotes: PacoteContabilService,
    private readonly zip: PacoteZipService,
    private readonly configuracao: ConfiguracaoService,
    private readonly extratos: ExtratoDoBancoService,
    private readonly tarifas: TarifasDoBancoService,
  ) {}

  /** Uma página crua de uma tabela do IXC, para conferir um relatório. */
  @Get('diagnostico/:tabela')
  lerTabela(@Param('tabela') tabela: string, @Query() pedido: PedidoDeDiagnostico) {
    return this.diagnostico.ler(tabela, pedido);
  }

  /**
   * O que a última montagem do extrato da ModoBank achou: quantos vieram, o
   * que ficou fora e por quê, e — não fechando — as saídas suspeitas cruas.
   */
  @Get('pacotes/:id/extrato-do-banco')
  extratoDoBanco(@Param('id') id: string) {
    return this.extratos.diagnostico(id);
  }

  /** Um lançamento da ModoBank como o banco o detalha. Só leitura. */
  @Get('banco/lancamentos/:id')
  lancamentoDoBanco(@Param('id') id: string) {
    return this.extratos.detalheCru(id);
  }

  // --- Tarifas e rentabilidade dos bancos, lançadas no IXC ---

  /** Os bancos em que se lançam tarifas (Sicoob, ModoBank, Bradesco). */
  @Get('tarifas/bancos')
  bancosDasTarifas() {
    return this.tarifas.bancos();
  }

  /** O que já está no IXC no período. Só leitura. */
  @Get('tarifas')
  tarifasLancadas(@Query('de') de = '', @Query('ate') ate = '') {
    return this.tarifas.lancadas(de, ate);
  }

  /** Lança uma tarifa ou rentabilidade (a tela manda o lote uma por vez). */
  @Post('tarifas')
  lancarTarifa(@Body() dto: LancarTarifaDto) {
    return this.tarifas.lancar(dto);
  }

  /**
   * Apaga uma tarifa ou rentabilidade: a 240 primeiro, a linha do banco depois.
   * `filha` é a 240 que ficou solta numa gravação recusada pela conferência.
   */
  @Delete('tarifas/:idMae')
  apagarTarifa(@Param('idMae', ParseIntPipe) idMae: number, @Query('filha') filha?: string) {
    const idFilha = filha ? Number(filha) : undefined;
    if (idFilha !== undefined && !(Number.isInteger(idFilha) && idFilha > 0)) {
      throw new BadRequestException('Linha da 240 inválida.');
    }
    return this.tarifas.apagar(idMae, idFilha);
  }

  /** Liga à linha do banco a 240 que o IXC gravou solta, e confere o par. */
  @Post('tarifas/:idMae/ligar/:idFilha')
  religarTarifa(
    @Param('idMae', ParseIntPipe) idMae: number,
    @Param('idFilha', ParseIntPipe) idFilha: number,
  ) {
    return this.tarifas.religar(idMae, idFilha);
  }

  // --- Os períodos ---

  @Get('pacotes')
  listar() {
    return this.pacotes.listar();
  }

  /** Abre o período (ou devolve o que já existe) e manda ler o IXC. */
  @Post('pacotes')
  @HttpCode(200)
  abrir(@Body() dto: AbrirPacoteDto, @Req() req: Request) {
    return this.pacotes.abrir(dto.de, dto.ate, usuarioId(req));
  }

  @Get('pacotes/:id')
  abrirNaTela(@Param('id') id: string) {
    return this.pacotes.abrirNaTela(id);
  }

  @Delete('pacotes/:id')
  @HttpCode(204)
  apagar(@Param('id') id: string) {
    return this.pacotes.apagar(id);
  }

  /** Lê o IXC de novo — tudo, ou só os itens pedidos. Volta na hora; a leitura corre por fora. */
  @Post('pacotes/:id/ler')
  @HttpCode(202)
  async lerDeNovo(@Param('id') id: string, @Body() dto: LerDeNovoDto) {
    await this.pacotes.lerDeNovo(id, dto.itens);
    return { lendo: true };
  }

  /** Os pagamentos de um item (8, 13, 14, 18), com o comprovante de cada um. */
  @Get('pacotes/:id/itens/:item/pagamentos')
  pagamentos(@Param('id') id: string, @Param('item', ParseIntPipe) item: number) {
    return this.pacotes.pagamentosDoItem(id, item);
  }

  @Put('pacotes/:id/marcas')
  @HttpCode(204)
  marcar(@Param('id') id: string, @Body() dto: MarcarDto, @Req() req: Request) {
    return this.pacotes.marcar(id, dto, usuarioId(req));
  }

  /** "Não tem comprovante" em vários pagamentos de uma vez. */
  @Put('pacotes/:id/marcas/pagamentos')
  marcarVarios(@Param('id') id: string, @Body() dto: MarcarVariosDto, @Req() req: Request) {
    return this.pacotes.marcarVarios(id, dto.titulos, dto.motivo ?? null, usuarioId(req));
  }

  // --- Arquivos ---

  @Post('pacotes/:id/arquivos')
  @HttpCode(201)
  enviar(@Param('id') id: string, @Body() dto: EnviarArquivoDto, @Req() req: Request) {
    return this.pacotes.enviarArquivo(id, dto, usuarioId(req));
  }

  @Get('arquivos/:id')
  async arquivo(@Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const a = await this.pacotes.arquivo(id);
    const conteudo = Buffer.from(a.conteudo);
    res.set({
      'Content-Type': a.tipo,
      'Content-Length': String(conteudo.length),
      'Content-Disposition': disposicao('inline', a.nome),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(conteudo);
  }

  @Delete('arquivos/:id')
  @HttpCode(204)
  apagarArquivo(@Param('id') id: string) {
    return this.pacotes.apagarArquivo(id);
  }

  /** O contrato quitado deixa de ir nos meses seguintes. */
  @Post('arquivos/:id/encerrar')
  @HttpCode(204)
  encerrar(@Param('id') id: string, @Body() dto: EncerrarContratoDto) {
    return this.pacotes.encerrarContrato(id, dto.em);
  }

  /** Um comprovante de pagamento, venha de onde vier (IXC, caixa, conta, recibo). */
  @Get('comprovante')
  async comprovante(
    @Query('origem') origem: string,
    @Query('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!['ixc', 'caixa', 'conta', 'recibo', 'rh', 'pacote'].includes(origem) || !id) {
      throw new BadRequestException('Comprovante inválido.');
    }
    const lido = await this.zip.lerComprovante({ origem: origem as 'ixc', id, nome: '' });
    if (!lido) throw new NotFoundException('Este comprovante não existe mais.');
    res.set({
      'Content-Type': lido.tipo,
      'Content-Length': String(lido.conteudo.length),
      'Content-Disposition': disposicao('inline', `comprovante.${lido.extensao}`),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(lido.conteudo);
  }

  // --- Planilhas e o pacote ---

  @Get('pacotes/:id/itens/:item/planilha')
  async planilha(
    @Param('id') id: string,
    @Param('item', ParseIntPipe) item: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const p = await this.zip.planilhaDoItem(id, item);
    if (!p) throw new NotFoundException('Este item ainda não tem planilha.');
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': String(p.conteudo.length),
      'Content-Disposition': disposicao('attachment', p.nome),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(p.conteudo);
  }

  @Get('pacotes/:id/zip')
  async baixar(@Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { nome, corpo } = await this.zip.montar(id);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': disposicao('attachment', nome),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(corpo);
  }

  // --- Ajustes ---

  @Get('configuracao')
  obterConfiguracao() {
    return this.configuracao.tela();
  }

  @Put('configuracao')
  salvarConfiguracao(@Body() dto: ConfiguracaoDto) {
    return this.configuracao.salvar(dto);
  }
}
