import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CategoriasService } from './categorias.service';
import {
  AtualizarCategoriaDto,
  ClassificarContaDto,
  ClassificarLoteDto,
  CriarCategoriaDto,
} from './dto/categoria.dto';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/** O cadastro de "com o que a empresa gasta" e a etiqueta de cada débito. */
@Controller()
export class CategoriasController {
  constructor(private readonly service: CategoriasService) {}

  @Get('categorias-despesa')
  listar(@Query('todas') todas?: string) {
    return this.service.listar(todas === 'true');
  }

  @Post('categorias-despesa')
  @HttpCode(201)
  criar(@Body() dto: CriarCategoriaDto) {
    return this.service.criar(dto.nome, dto.paiId ?? null);
  }

  @Patch('categorias-despesa/:id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarCategoriaDto) {
    return this.service.atualizar(id, dto);
  }

  @Delete('categorias-despesa/:id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.service.remover(id);
    return { ok: true };
  }

  /**
   * A mesma etiqueta em vários débitos de uma vez, para classificar o que já
   * está em aberto sem abrir um por um. `categoriaId` vazio tira a etiqueta de
   * todos eles.
   */
  @Put('contas-abertas/categoria-lote')
  @HttpCode(200)
  async classificarEmLote(
    @Body() dto: ClassificarLoteDto,
    @Req() req: Request,
  ) {
    const classificadas = await this.service.classificarEmLote(
      dto.idsFnApagar,
      dto.categoriaId ?? null,
      usuarioId(req),
    );
    return { ok: true, classificadas };
  }

  /** A que se refere este débito. Corpo vazio tira a etiqueta. */
  @Put('contas-abertas/:idFnApagar/categoria')
  @HttpCode(200)
  async classificar(
    @Param('idFnApagar', ParseIntPipe) idFnApagar: number,
    @Body() dto: ClassificarContaDto,
    @Req() req: Request,
  ) {
    await this.service.classificar(
      idFnApagar,
      dto.categoriaId ?? null,
      usuarioId(req),
    );
    return { ok: true };
  }
}
