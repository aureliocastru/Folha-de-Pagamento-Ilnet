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
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
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

  /**
   * Trocar a etiqueta de um pagamento **que já saiu** — e isso é de ADMIN.
   *
   * A conta paga é a que já entrou em relatório: o mês foi fechado com ela
   * naquela fatia, e quem olhou o painel decidiu alguma coisa com aquele
   * número. Reclassificar depois é reescrever um número que alguém já leu —
   * às vezes é exatamente o certo a fazer (a etiqueta estava errada), mas é
   * decisão de quem responde pelo relatório, não de quem lança o dia a dia.
   *
   * É a mesma etiqueta e a mesma tabela da conta em aberto; o que muda é o
   * perfil que pode mexer. Por isso a rota é outra, com o `@Roles` nela: uma
   * rota só, aberta a todos, não teria onde pendurar essa diferença.
   */
  @Put('pagamentos/:idFnApagar/categoria')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  async reclassificarPagamento(
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
