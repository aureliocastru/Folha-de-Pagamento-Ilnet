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
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { AssinarDto } from '../assinaturas/dto/assinatura.dto';
import { CONTRATO_PADRAO, blocosDoContrato } from './contrato.texto';
import { ContratosDePatrocinioService } from './contratos.service';
import {
  AtualizarPatrocinadoDto,
  CriarPatrocinadoDto,
  GuardarArquivoDto,
  GuardarEscaneadoDto,
} from './dto/patrocinio.dto';
import { PatrocinioService } from './patrocinio.service';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/** De onde partiu a assinatura — o primeiro endereço do X-Forwarded-For. */
function origemDaRequisicao(req: Request): { ip?: string; userAgent?: string } {
  const encaminhado = req.headers['x-forwarded-for'];
  const cabecalho = Array.isArray(encaminhado) ? encaminhado[0] : encaminhado;
  const ip = cabecalho?.split(',')[0].trim() || req.ip;
  return { ip, userAgent: req.headers['user-agent'] };
}

/**
 * Serve um arquivo guardado, para abrir na aba. O nome vai nas duas formas — a
 * simples, sem acento, para cliente velho, e a `filename*`, que preserva o
 * acento (ver o `RhController`).
 */
function servir(
  res: Response,
  arquivo: { nome: string; tipo: string; conteudo: Buffer },
): StreamableFile {
  res.set({
    'Content-Type': arquivo.tipo,
    'Content-Length': String(arquivo.conteudo.length),
    'Content-Disposition':
      `inline; filename="${semAcento(arquivo.nome)}"; ` +
      `filename*=UTF-8''${encodeURIComponent(arquivo.nome)}`,
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(arquivo.conteudo);
}

/**
 * O módulo de patrocínio, de dentro (com login).
 *
 * A guarda de módulos o reconhece pelo prefixo `patrocinios` — ver
 * `MODULO_DA_ROTA`. As rotas de nome fixo vêm antes de `:id`, ou "recebedores"
 * seria lido como o id de um patrocinado.
 */
@Controller('patrocinios')
export class PatrocinioController {
  constructor(
    private readonly service: PatrocinioService,
    private readonly contratos: ContratosDePatrocinioService,
  ) {}

  @Get()
  listar(@Query('busca') busca?: string, @Query('todos') todos?: string) {
    return this.service.listar(busca, todos === 'true');
  }

  /** O contrato que vai no link, para quem quer ler antes de mandar. */
  @Get('contrato-padrao')
  contratoPadrao() {
    return { texto: CONTRATO_PADRAO, blocos: blocosDoContrato(CONTRATO_PADRAO) };
  }

  /** Os diaristas que podem receber por um patrocinado. */
  @Get('recebedores')
  recebedores(@Query('busca') busca?: string) {
    return this.service.recebedores(busca);
  }

  // --- Arquivos e contratos, pelo id deles ---

  @Get('arquivos/:arquivoId')
  async arquivo(
    @Param('arquivoId') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const a = await this.service.arquivo(id);
    return servir(res, {
      nome: a.arquivoNome,
      tipo: a.arquivoTipo,
      conteudo: Buffer.from(a.arquivo),
    });
  }

  @Delete('arquivos/:arquivoId')
  @HttpCode(200)
  async removerArquivo(@Param('arquivoId') id: string) {
    await this.service.removerArquivo(id);
    return { ok: true };
  }

  @Get('contratos/:contratoId')
  contrato(@Param('contratoId') id: string) {
    return this.contratos.doContrato(id);
  }

  /** O escaneado como chegou, ou o assinado pelo link em PDF. */
  @Get('contratos/:contratoId/arquivo')
  async arquivoDoContrato(
    @Param('contratoId') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return servir(res, await this.contratos.paraBaixar(id));
  }

  @Delete('contratos/:contratoId')
  @HttpCode(200)
  async removerContrato(@Param('contratoId') id: string) {
    await this.contratos.remover(id);
    return { ok: true };
  }

  // --- O patrocinado ---

  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarPatrocinadoDto, @Req() req: Request) {
    return this.service.criar(dto, usuarioId(req));
  }

  @Get(':id')
  ficha(@Param('id') id: string) {
    return this.service.ficha(id);
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarPatrocinadoDto) {
    return this.service.atualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.service.remover(id);
    return { ok: true };
  }

  @Post(':id/arquivos')
  @HttpCode(201)
  guardarArquivo(
    @Param('id') id: string,
    @Body() dto: GuardarArquivoDto,
    @Req() req: Request,
  ) {
    return this.service.guardarArquivo(id, dto, usuarioId(req));
  }

  /** Abre (ou renova) o link para o patrocinado assinar. */
  @Post(':id/contratos/link')
  @HttpCode(201)
  gerarLink(@Param('id') id: string, @Req() req: Request) {
    return this.contratos.gerarLink(id, usuarioId(req));
  }

  /** O contrato físico do patrocínio antigo, escaneado. */
  @Post(':id/contratos/escaneado')
  @HttpCode(201)
  guardarEscaneado(
    @Param('id') id: string,
    @Body() dto: GuardarEscaneadoDto,
    @Req() req: Request,
  ) {
    return this.contratos.guardarEscaneado(id, dto, usuarioId(req));
  }
}

/**
 * A assinatura do contrato, de fora (sem login).
 *
 * O patrocinado não tem conta aqui e não vai criar uma para assinar: o link é
 * a credencial dele. O prefixo fica fora da tabela de módulos de propósito —
 * rota que não é de módulo nenhum passa pela guarda (ver `MODULO_DA_ROTA`).
 */
@Controller('assinar-contrato')
export class AssinarContratoController {
  constructor(private readonly contratos: ContratosDePatrocinioService) {}

  @Public()
  @Get(':token')
  abrir(@Param('token') token: string) {
    return this.contratos.abrirPorToken(token);
  }

  @Public()
  @Post(':token')
  @HttpCode(200)
  assinar(
    @Param('token') token: string,
    @Body() dto: AssinarDto,
    @Req() req: Request,
  ) {
    return this.contratos.assinar(token, dto, origemDaRequisicao(req));
  }
}

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/"/g, "'");
}
