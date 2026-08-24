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
  EditarDocumentoDto,
  GuardarDocumentoDto,
  GuardarRecibosDto,
  PastaDto,
} from './dto/documento.dto';
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
  listar(@Query('pastaId') pastaId: string, @Query('termo') termo?: string) {
    return this.documentos.listar(pastaId, termo);
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

  @Post('documentos')
  guardar(@Body() dto: GuardarDocumentoDto, @Req() req: Request) {
    return this.documentos.guardar(dto, usuarioId(req));
  }

  @Patch('documentos/:id')
  editar(@Param('id') id: string, @Body() dto: EditarDocumentoDto) {
    return this.documentos.editar(id, dto);
  }

  @Delete('documentos/:id')
  apagar(@Param('id') id: string) {
    return this.documentos.apagar(id);
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
