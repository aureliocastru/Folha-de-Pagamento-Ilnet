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
import { AprService, type AutorApr, type Origem } from './apr.service';
import { CatalogoAprService } from './catalogo.service';
import {
  AssinarExecutanteDto,
  AtualizarAprDto,
  AtualizarItemAprDto,
  AtualizarModeloAprDto,
  CancelarAprDto,
  CriarAprDto,
  CriarModeloAprDto,
  ItemAprDto,
  ProrrogarAprDto,
  QueryAprDto,
  ReordenarItensDto,
  SupervisaoAprDto,
} from './dto/apr.dto';

/** Quem está pedindo — o JwtStrategy põe o usuário na requisição. */
function autor(req: Request): AutorApr {
  const u = req.user as { id?: string; nome?: string; role?: UserRole };
  return {
    id: u?.id,
    nome: u?.nome ?? 'Desconhecido',
    role: u?.role ?? UserRole.VISUALIZADOR,
  };
}

function origem(req: Request): Origem {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

/**
 * Segurança do Trabalho — a análise de risco que o técnico preenche antes do
 * serviço.
 *
 * Sem `@Roles` na classe de propósito: vale a regra geral da casa (quem é
 * VISUALIZADOR só lê, os outros escrevem). Quem entra aqui é assunto do
 * `ModulosGuard`, e é lá que está a única exceção do módulo — o perfil TECNICO
 * abre este e mais nada.
 *
 * As rotas do catálogo, que reescrevem o formulário em branco de todo mundo,
 * são as únicas com perfil próprio.
 */
@Controller('apr')
export class AprController {
  constructor(
    private readonly apr: AprService,
    private readonly catalogo: CatalogoAprService,
  ) {}

  // --- O formulário em branco -----------------------------------------------
  // Antes de `:id` de propósito: o Nest casa as rotas na ordem em que elas são
  // declaradas, e `/apr/formulario` viraria uma APR de id "formulario".

  /** O formulário que a tela desenha: cabeçalho, blocos e itens ativos. */
  @Get('formulario')
  formulario(@Query('modeloId') modeloId?: string) {
    return this.catalogo.formulario(modeloId);
  }

  /** Os funcionários que podem entrar numa equipe. */
  @Get('equipe')
  equipe() {
    return this.apr.equipe();
  }

  @Get('modelos')
  modelos(@Query('todos') todos?: string) {
    return this.catalogo.modelos(todos === 'true');
  }

  // --- O catálogo, que é de quem cuida da segurança do trabalho -------------

  @Roles(UserRole.ADMIN, UserRole.RH)
  @Post('modelos')
  @HttpCode(201)
  criarModelo(@Body() dto: CriarModeloAprDto) {
    return this.catalogo.criarModelo(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.RH)
  @Patch('modelos/:id')
  atualizarModelo(@Param('id') id: string, @Body() dto: AtualizarModeloAprDto) {
    return this.catalogo.atualizarModelo(id, dto);
  }

  /** O catálogo inteiro, inclusive o que está desativado. */
  @Roles(UserRole.ADMIN, UserRole.RH)
  @Get('modelos/:id/itens')
  itens(@Param('id') id: string) {
    return this.catalogo.itens(id);
  }

  @Roles(UserRole.ADMIN, UserRole.RH)
  @Post('modelos/:id/itens')
  @HttpCode(201)
  criarItem(@Param('id') id: string, @Body() dto: ItemAprDto) {
    return this.catalogo.criarItem(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.RH)
  @Patch('itens/ordem')
  reordenar(@Body() dto: ReordenarItensDto) {
    return this.catalogo.reordenar(dto.ids);
  }

  @Roles(UserRole.ADMIN, UserRole.RH)
  @Patch('itens/:id')
  atualizarItem(@Param('id') id: string, @Body() dto: AtualizarItemAprDto) {
    return this.catalogo.atualizarItem(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.RH)
  @Delete('itens/:id')
  @HttpCode(200)
  removerItem(@Param('id') id: string) {
    return this.catalogo.removerItem(id);
  }

  // --- As assinaturas -------------------------------------------------------
  // Também antes de `:id`: "executantes" não é um id de APR.

  /** A assinatura de um executante, colhida no aparelho na hora. */
  @Post('executantes/:executanteId/assinar')
  @HttpCode(200)
  assinar(
    @Param('executanteId') executanteId: string,
    @Body() dto: AssinarExecutanteDto,
    @Req() req: Request,
  ) {
    return this.apr.assinar(executanteId, dto, autor(req), origem(req));
  }

  // --- As APRs --------------------------------------------------------------

  @Get()
  listar(@Query() query: QueryAprDto, @Req() req: Request) {
    return this.apr.listar(query, autor(req));
  }

  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarAprDto, @Req() req: Request) {
    return this.apr.criar(dto, autor(req));
  }

  @Get(':id')
  buscar(@Param('id') id: string, @Req() req: Request) {
    return this.apr.buscar(id, autor(req));
  }

  /**
   * O papel.
   *
   * Vai `inline`: PDF abre na aba, que é o que quem clica em "ver" espera. O
   * nome vai nas duas formas — a simples, sem acento, para cliente velho, e a
   * `filename*`, que é a que preserva o que tem acento.
   */
  @Get(':id/pdf')
  async pdf(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { nome, conteudo } = await this.apr.pdf(id, autor(req));

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(conteudo.length),
      'Content-Disposition':
        `inline; filename="${semAcento(nome)}"; ` +
        `filename*=UTF-8''${encodeURIComponent(nome)}`,
      // Documento da casa: nenhum intermediário tem por que guardar cópia.
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(conteudo);
  }

  @Patch(':id')
  atualizar(
    @Param('id') id: string,
    @Body() dto: AtualizarAprDto,
    @Req() req: Request,
  ) {
    return this.apr.atualizar(id, dto, autor(req));
  }

  /** Confere o que falta e libera o serviço. */
  @Post(':id/liberar')
  @HttpCode(200)
  liberar(@Param('id') id: string, @Req() req: Request) {
    return this.apr.liberar(id, autor(req));
  }

  @Post(':id/encerrar')
  @HttpCode(200)
  encerrar(
    @Param('id') id: string,
    @Body() body: { fimEm?: string },
    @Req() req: Request,
  ) {
    return this.apr.encerrar(id, autor(req), body?.fimEm);
  }

  @Post(':id/prorrogar')
  @HttpCode(200)
  prorrogar(
    @Param('id') id: string,
    @Body() dto: ProrrogarAprDto,
    @Req() req: Request,
  ) {
    return this.apr.prorrogar(id, dto, autor(req));
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(
    @Param('id') id: string,
    @Body() dto: CancelarAprDto,
    @Req() req: Request,
  ) {
    return this.apr.cancelar(id, dto, autor(req));
  }

  /** Quem supervisiona confere e assina embaixo. Não é quem executa. */
  @Roles(UserRole.ADMIN, UserRole.RH)
  @Post(':id/supervisao')
  @HttpCode(200)
  supervisionar(
    @Param('id') id: string,
    @Body() dto: SupervisaoAprDto,
    @Req() req: Request,
  ) {
    return this.apr.supervisionar(id, dto, autor(req));
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
