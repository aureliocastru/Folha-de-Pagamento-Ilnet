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
} from '@nestjs/common';
import type { Request } from 'express';
import { CartoesCreditoService } from './cartoes-credito.service';
import {
  AtualizarCartaoDto,
  AtualizarCompraDto,
  CriarCartaoDto,
  CriarCompraDto,
  EncerrarAssinaturaDto,
  GerarFaturaDto,
} from './dto/cartao-credito.dto';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/**
 * Os cartões de crédito da empresa: as compras de cada fatura, parceladas ou
 * não, e o botão que faz a fatura do mês virar uma conta a pagar só.
 */
@Controller('cartoes-credito')
export class CartoesCreditoController {
  constructor(private readonly service: CartoesCreditoService) {}

  /** Cada cartão e a fatura do mês pedido (AAAA-MM do vencimento). */
  @Get()
  listar(@Query('competencia') competencia?: string) {
    return this.service.listar(competencia);
  }

  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarCartaoDto, @Req() req: Request) {
    return this.service.criar(dto, usuarioId(req));
  }

  @Patch('compras/:compraId')
  atualizarCompra(
    @Param('compraId') compraId: string,
    @Body() dto: AtualizarCompraDto,
  ) {
    return this.service.atualizarCompra(compraId, dto);
  }

  /** A assinatura sai da fatura `aPartirDe` e das seguintes. */
  @Post('compras/:compraId/encerrar')
  @HttpCode(200)
  encerrarAssinatura(
    @Param('compraId') compraId: string,
    @Body() dto: EncerrarAssinaturaDto,
  ) {
    return this.service.encerrarAssinatura(compraId, dto.aPartirDe);
  }

  @Delete('compras/:compraId')
  @HttpCode(200)
  async removerCompra(@Param('compraId') compraId: string) {
    await this.service.removerCompra(compraId);
    return { ok: true };
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarCartaoDto) {
    return this.service.atualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.service.remover(id);
    return { ok: true };
  }

  @Post(':id/compras')
  @HttpCode(201)
  criarCompra(
    @Param('id') id: string,
    @Body() dto: CriarCompraDto,
    @Req() req: Request,
  ) {
    return this.service.criarCompra(id, dto, usuarioId(req));
  }

  /** A fatura do mês vira uma conta a pagar no IXC, no valor da soma. */
  @Post(':id/gerar')
  @HttpCode(200)
  gerar(
    @Param('id') id: string,
    @Body() dto: GerarFaturaDto,
    @Req() req: Request,
  ) {
    return this.service.gerarFatura(
      id,
      dto.competencia,
      { dataVencimento: dto.dataVencimento, codigo: dto.codigo },
      usuarioId(req),
    );
  }
}
