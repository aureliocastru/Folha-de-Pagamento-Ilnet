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
import { ContasContratoService } from './contas-contrato.service';
import {
  AtualizarContaContratoDto,
  CriarContaContratoDto,
  DescobrirContasContratoDto,
  GerarContasContratoDto,
  ImportarContasContratoDto,
} from './dto/conta-contrato.dto';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/**
 * As contas de energia dos endereços da empresa — uma conta contrato por
 * unidade consumidora — e o botão que faz cada fatura virar conta a pagar.
 */
@Controller('contas-contrato')
export class ContasContratoController {
  constructor(private readonly service: ContasContratoService) {}

  /**
   * O cadastro e como cada endereço está no mês pedido: o que já foi lançado,
   * o que falta, e quanto cada um costuma custar.
   */
  @Get()
  listar(
    @Query('competencia') competencia?: string,
    @Query('ativas') ativas?: string,
  ) {
    return this.service.listar(competencia, ativas !== 'true');
  }

  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarContaContratoDto, @Req() req: Request) {
    return this.service.criar(dto, usuarioId(req));
  }

  /**
   * Procura no IXC o que já se sabe sobre estas contas contrato.
   *
   * As contas de luz são pagas há anos, e cada fatura virou um título com o
   * número escrito na observação. É de lá que sai o dia em que cada endereço
   * vence e quanto ele costuma custar — perguntar isso a quem cadastra seria
   * pedir de cabeça o que já está escrito.
   */
  @Post('descobrir')
  @HttpCode(200)
  descobrir(@Body() dto: DescobrirContasContratoDto) {
    return this.service.descobrirNoHistorico(dto.numeros);
  }

  /** Cadastra de uma vez os endereços que a descoberta trouxe. */
  @Post('importar')
  @HttpCode(200)
  importar(@Body() dto: ImportarContasContratoDto, @Req() req: Request) {
    return this.service.importar(
      {
        idFornecedorIxc: dto.idFornecedorIxc,
        fornecedorNome: dto.fornecedorNome,
        contaContabil: dto.contaContabil,
        contaPagamento: dto.contaPagamento,
        tipoPagamentoIxc: dto.tipoPagamentoIxc,
        categoriaId: dto.categoriaId ?? null,
      },
      dto.itens,
      usuarioId(req),
    );
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarContaContratoDto) {
    return this.service.atualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.service.remover(id);
    return { ok: true };
  }

  /**
   * Lança no IXC as faturas informadas. Uma por vez lá dentro: o que já entrou
   * fica de pé se a seguinte falhar, e a resposta diz quais passaram.
   */
  @Post('gerar')
  @HttpCode(200)
  gerar(@Body() dto: GerarContasContratoDto, @Req() req: Request) {
    return this.service.gerar(dto.competencia, dto.lancamentos, usuarioId(req));
  }
}
