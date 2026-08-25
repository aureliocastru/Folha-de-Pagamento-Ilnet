import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { ContasPagarService } from './contas-pagar.service';
import { CriarContasPagarDto } from './dto/criar-contas.dto';
import { PrepararFolhaDto } from './dto/preparar-folha.dto';
import {
  AuditoriaDto,
  LoteContasDto,
  QueryContasPagarDto,
} from './dto/query-contas.dto';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

@Controller('contas-pagar')
export class ContasPagarController {
  constructor(private readonly service: ContasPagarService) {}

  /** Preview dos lançamentos de uma competência (não persiste). */
  @Post('preparar-folha')
  @HttpCode(200)
  prepararFolha(@Body() dto: PrepararFolhaDto) {
    return this.service.prepararFolha(dto);
  }

  /** Cria as contas a pagar (salva localmente e envia ao IXC). */
  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarContasPagarDto, @Req() req: Request) {
    return this.service.criar(dto, usuarioId(req));
  }

  @Get()
  listar(@Query() query: QueryContasPagarDto) {
    return this.service.listar(query);
  }

  /**
   * Etiqueta como despesa de folha o que ficou sem categoria.
   *
   * A conta da folha já nasce etiquetada; isto é para o que veio antes disso,
   * ou para o buraco que sobrou de uma base em que a categoria ainda não
   * existia. Roda quantas vezes for preciso: o que já tem etiqueta não é
   * tocado.
   *
   * De ADMIN, pela mesma razão que reclassificar pagamento feito é: mexe na
   * fatia de meses que já foram lidos e decididos.
   *
   * Antes de ":id" para não ser lido como um id de conta.
   */
  @Post('etiquetar-folha')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  etiquetarFolha() {
    return this.service.etiquetarFolhaSemCategoria();
  }

  /**
   * O que o app entendeu do rádio "Tipo da chave Pix" no fn_apagar desta base.
   * Antes de ":id" para não ser lido como um id de conta.
   */
  @Get('diagnostico-pix')
  diagnosticoPix() {
    return this.service.diagnosticoTipoChavePix();
  }

  @Get(':id')
  buscar(@Param('id') id: string) {
    return this.service.buscar(id);
  }

  /** Reenvia ao IXC uma conta em rascunho/erro. */
  @Post(':id/enviar')
  @HttpCode(200)
  enviar(@Param('id') id: string) {
    return this.service.enviarIxc(id);
  }

  // Em massa. Declarados antes das rotas com :id só para ficarem juntos — não
  // colidem, porque estas têm um segmento só.
  @Post('aprovar-lote')
  @HttpCode(200)
  aprovarLote(@Body() dto: LoteContasDto, @Req() req: Request) {
    return this.service.aprovarEmLote(dto.ids, dto.motivo ?? '', usuarioId(req));
  }

  @Post('reprovar-lote')
  @HttpCode(200)
  reprovarLote(@Body() dto: LoteContasDto, @Req() req: Request) {
    return this.service.reprovarEmLote(
      dto.ids,
      dto.motivo ?? '',
      usuarioId(req),
    );
  }

  /** Apaga várias contas aqui e os fn_apagar correspondentes no IXC. */
  @Post('excluir-lote')
  @HttpCode(200)
  excluirLote(@Body() dto: LoteContasDto) {
    return this.service.removerEmLote(dto.ids);
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  aprovar(@Param('id') id: string, @Body() dto: AuditoriaDto, @Req() req: Request) {
    return this.service.aprovar(id, dto.motivo, usuarioId(req));
  }

  @Post(':id/reprovar')
  @HttpCode(200)
  reprovar(@Param('id') id: string, @Body() dto: AuditoriaDto, @Req() req: Request) {
    return this.service.reprovar(id, dto.motivo, usuarioId(req));
  }

  /**
   * Consulta a conta no IXC: marca como paga quando o banco retorna, reflete a
   * auditoria feita por lá e apaga daqui o que foi apagado no IXC.
   */
  @Post(':id/sincronizar')
  @HttpCode(200)
  sincronizar(@Param('id') id: string) {
    return this.service.sincronizarStatus(id);
  }

  @Post('sincronizar-pendentes')
  @HttpCode(200)
  sincronizarPendentes() {
    return this.service.sincronizarPendentes();
  }

  /** Apaga a conta aqui e o fn_apagar no IXC. */
  @Delete(':id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.service.remover(id);
    return { ok: true };
  }
}
