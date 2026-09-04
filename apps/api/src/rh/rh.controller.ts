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
  Res,
  StreamableFile,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { DocumentosRhService } from './documentos.service';
import {
  AnalisarRecibosDto,
  ApagarDocumentosDto,
  CopiarParaLicitacaoDto,
  EditarDocumentoDto,
  GuardarDocumentoDto,
  GuardarRecibosDto,
  LicitacaoDto,
  MoverDocumentosDto,
  NotaFiscalDto,
  PastaDto,
  SubstituirDocumentoDto,
} from './dto/documento.dto';
import { LicitacoesService } from './licitacoes.service';
import { NotasFiscaisService } from './notas-fiscais.service';
import { PastaEmZipService } from './pasta-em-zip.service';
import { RecibosDaFolhaService } from './recibos.service';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/**
 * Quem manda na estante inteira.
 *
 * O RH cuida do que ele mesmo criou — a pasta avulsa, a divisória da gaveta. O
 * administrador mexe em qualquer pasta: renomeia a que veio do cadastro e apaga
 * a que tem papel dentro. É a mesma linha que separa quem opera de quem
 * responde pelo arquivo, e ela mora no servidor porque é lá que ela vale.
 */
function ehAdmin(req: Request): boolean {
  return (req.user as { role?: UserRole } | undefined)?.role === UserRole.ADMIN;
}

/**
 * A estante de documentos do RH.
 *
 * O módulo inteiro é de ADMIN e RH — contrato, advertência, exame médico e CPF
 * não são coisa que se mostre a quem entrou para conferir um pagamento. A
 * guarda geral só barra escrita; aqui a leitura também precisa de perfil, e por
 * isso o `@Roles` está na classe e não em cada rota (a próxima rota nasce
 * protegida sem ninguém lembrar dela).
 */
@Controller('rh')
@Roles(UserRole.ADMIN, UserRole.RH)
export class RhController {
  constructor(
    private readonly documentos: DocumentosRhService,
    private readonly recibos: RecibosDaFolhaService,
    private readonly licitacoes: LicitacoesService,
    private readonly notas: NotasFiscaisService,
    private readonly zip: PastaEmZipService,
  ) {}

  // --- A estante ------------------------------------------------------------

  /** Todas as pastas, com o que há em cada uma. */
  @Get('pastas')
  pastas() {
    return this.documentos.pastas();
  }

  /** Uma pasta para quem não está no cadastro de funcionários. */
  @Post('pastas')
  criarPasta(@Body() dto: PastaDto, @Req() req: Request) {
    return this.documentos.criarPasta(dto, usuarioId(req));
  }

  @Patch('pastas/:id')
  renomearPasta(
    @Param('id') id: string,
    @Body() dto: PastaDto,
    @Req() req: Request,
  ) {
    return this.documentos.renomearPasta(id, dto, ehAdmin(req));
  }

  @Delete('pastas/:id')
  apagarPasta(@Param('id') id: string, @Req() req: Request) {
    return this.documentos.apagarPasta(id, ehAdmin(req));
  }

  // --- Os documentos --------------------------------------------------------

  /** Os tipos já usados, para a tela sugerir em vez de perguntar. */
  @Get('documentos/tipos')
  tipos() {
    return this.documentos.tipos();
  }

  /**
   * O que há numa pasta.
   *
   * Nunca traz o arquivo: são megabytes cada, e a tela mostra dezenas de linhas.
   */
  @Get('documentos')
  listar(
    @Query('pastaId') pastaId: string,
    @Query('termo') termo?: string,
    /**
     * Traz junto o que está nas divisorias de dentro -- menos os substituidos.
     * E o que a montagem de uma licitacao precisa: ver tudo que a empresa tem
     * sem abrir gaveta por gaveta.
     */
    @Query('comSubpastas') comSubpastas?: string,
  ) {
    return this.documentos.listar(pastaId, termo, comSubpastas === 'true');
  }

  /**
   * O arquivo em si.
   *
   * Vai `inline`: PDF e imagem abrem na aba, que é o que quem clica em "ver"
   * espera. O nome vai nas duas formas — a simples, sem acento, para cliente
   * velho, e a `filename*`, que é a que preserva "Contratação".
   */
  @Get('documentos/:id/arquivo')
  async arquivo(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const doc = await this.documentos.arquivo(id);
    const conteudo = Buffer.from(doc.arquivo);

    res.set({
      'Content-Type': doc.arquivoTipo,
      'Content-Length': String(conteudo.length),
      'Content-Disposition':
        `inline; filename="${semAcento(doc.arquivoNome)}"; ` +
        `filename*=UTF-8''${encodeURIComponent(doc.arquivoNome)}`,
      // O documento é da casa: nenhum intermediário tem por que guardar cópia.
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(conteudo);
  }

  /**
   * A pasta inteira num zip, com as subpastas viradas diretórios.
   *
   * É o pacote da licitação saindo daqui como um arquivo só — o caminho que
   * existia era abrir os quarenta documentos um a um pelo botão "Ver".
   */
  @Get('pastas/:id/zip')
  async pastaEmZip(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { nome, corpo } = await this.zip.montar(id);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition':
        `attachment; filename="${semAcento(nome)}"; ` +
        `filename*=UTF-8''${encodeURIComponent(nome)}`,
      // Os documentos são da casa: nenhum intermediário guarda cópia.
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(corpo);
  }

  @Post('documentos')
  guardar(@Body() dto: GuardarDocumentoDto, @Req() req: Request) {
    return this.documentos.guardar(dto, usuarioId(req));
  }

  @Patch('documentos/:id')
  editar(@Param('id') id: string, @Body() dto: EditarDocumentoDto) {
    return this.documentos.editar(id, dto);
  }

  /**
   * Muda de divisória os documentos marcados.
   *
   * Rota própria, e não um `PATCH` por documento, porque arrumar uma pasta é um
   * gesto só: vinte requisições que podem falhar na décima deixariam metade da
   * mudança feita, e nenhuma tela sabe explicar isso.
   */
  @Post('documentos/mover')
  @HttpCode(200)
  mover(@Body() dto: MoverDocumentosDto) {
    return this.documentos.mover(dto.documentoIds, dto.pastaId);
  }

  /**
   * Apaga os documentos marcados.
   *
   * `POST` e não `DELETE` porque a lista vai no corpo, e corpo em `DELETE` é
   * coisa que proxy pelo caminho descarta sem avisar — aqui isso seria apagar
   * uma lista diferente da que a tela mandou.
   */
  @Post('documentos/apagar-lote')
  @HttpCode(200)
  apagarVarios(@Body() dto: ApagarDocumentosDto) {
    return this.documentos.apagarVarios(dto.documentoIds);
  }

  /**
   * O documento novo entra no lugar do que venceu.
   *
   * O antigo não se apaga: desce para a gaveta "Substituídos" da própria pasta.
   * Ele é a prova de que a empresa estava regular naquele mês, e é ele que se
   * apresenta quando alguém pergunta do ano passado.
   */
  @Post('documentos/:id/substituir')
  substituir(
    @Param('id') id: string,
    @Body() dto: SubstituirDocumentoDto,
    @Req() req: Request,
  ) {
    return this.documentos.substituir(id, dto, usuarioId(req));
  }

  @Delete('documentos/:id')
  apagar(@Param('id') id: string) {
    return this.documentos.apagar(id);
  }

  // --- As licitacoes --------------------------------------------------------

  /**
   * Cada licitacao e uma pasta, e o que ela guarda e a fotografia do que foi
   * entregue naquele dia -- copia, e nao atalho: renovar a certidao na pasta da
   * empresa no mes seguinte nao pode reescrever o que ja foi mandado.
   */
  @Get('licitacoes')
  licitacoesAbertas() {
    return this.licitacoes.listar();
  }

  @Post('licitacoes')
  abrirLicitacao(@Body() dto: LicitacaoDto, @Req() req: Request) {
    return this.licitacoes.criar(dto.nome, usuarioId(req));
  }

  /** Manda para dentro da licitacao os documentos marcados na pasta da empresa. */
  @Post('licitacoes/:id/documentos')
  @HttpCode(200)
  copiarParaLicitacao(
    @Param('id') id: string,
    @Body() dto: CopiarParaLicitacaoDto,
    @Req() req: Request,
  ) {
    return this.licitacoes.copiar(id, dto.documentoIds, usuarioId(req));
  }

  // --- As notas fiscais de entrada -----------------------------------------

  /**
   * Os meses que ja tem nota, com quantas e quanto deu.
   *
   * O total vem daqui, e nao de somar na tela: a tela mostra um mes por vez, e
   * quem confere com a contabilidade quer o do ano inteiro sem abrir doze.
   */
  @Get('notas-fiscais')
  mesesDeNotas() {
    return this.notas.meses();
  }

  /** O que entrou num mes. */
  @Get('notas-fiscais/:competencia')
  notasDoMes(@Param('competencia') competencia: string) {
    return this.notas.doMes(competencia);
  }

  @Post('notas-fiscais')
  guardarNota(@Body() dto: NotaFiscalDto, @Req() req: Request) {
    return this.notas.guardar(dto, usuarioId(req));
  }

  /** Corrige os dados. O arquivo nao: esse se apaga e se sobe de novo. */
  @Patch('notas-fiscais/:id')
  editarNota(
    @Param('id') id: string,
    @Body() dto: NotaFiscalDto,
    @Req() req: Request,
  ) {
    return this.notas.editar(id, dto, usuarioId(req));
  }

  @Delete('notas-fiscais/:id')
  apagarNota(@Param('id') id: string) {
    return this.notas.apagar(id);
  }

  // --- Os recibos da folha --------------------------------------------------

  /**
   * Lê o PDF da folha e diz o que achou. Não grava nada.
   *
   * A conferência é da pessoa: um recibo na pasta errada é pior que um recibo
   * fora da pasta, e nenhum casamento automático é bom o bastante para
   * dispensar quem está olhando.
   */
  @Post('recibos/analisar')
  @HttpCode(200)
  analisarRecibos(@Body() dto: AnalisarRecibosDto) {
    return this.recibos.analisar(dto.arquivo);
  }

  /** Corta o PDF e guarda cada recibo na pasta confirmada. */
  @Post('recibos')
  guardarRecibos(@Body() dto: GuardarRecibosDto, @Req() req: Request) {
    return this.recibos.guardar(
      dto.arquivo,
      dto.competencia,
      dto.itens,
      dto.arquivoNome ?? 'recibos.pdf',
      usuarioId(req),
    );
  }

  /** O histórico: cada vez que um arquivo do mês foi separado. */
  @Get('recibos/lotes')
  lotes() {
    return this.recibos.lotes();
  }

  /**
   * Desfaz um lançamento inteiro: apaga de todas as pastas o que ele guardou.
   *
   * É a única saída de quem separou o arquivo errado — sem isto, o conserto
   * seria caçar vinte e três documentos em vinte e três pastas diferentes.
   */
  @Delete('recibos/lotes/:id')
  desfazerLote(@Param('id') id: string) {
    return this.recibos.desfazer(id);
  }
}

/** O cabeçalho HTTP não carrega acento: a versão sem ele é a de reserva. */
function semAcento(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '');
}
