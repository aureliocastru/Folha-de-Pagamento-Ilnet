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
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FornecedorService } from '../financeiro/fornecedor.service';
import { DespesasService } from './despesas.service';
import {
  AnexarNotaDto,
  CriarDespesaDto,
  EditarTituloDto,
  ExcluirLoteDto,
  PagarLoteDto,
  PagarTituloDto,
} from './dto/despesa.dto';
import { PagamentosService } from './pagamentos.service';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

function usuarioNome(req: Request): string | undefined {
  return (req.user as { nome?: string } | undefined)?.nome;
}

/** Lançar uma conta a pagar à mão, e achar no IXC o fornecedor dela. */
@Controller()
export class DespesasController {
  constructor(
    private readonly service: DespesasService,
    private readonly fornecedores: FornecedorService,
    private readonly pagamentos: PagamentosService,
  ) {}

  /**
   * Paga um título que já está no IXC. Pelo banco, aprova e deixa pronto; em
   * mãos, aprova e dá a baixa na conta do caixa.
   */
  @Post('contas-abertas/:idFnApagar/pagar')
  @HttpCode(200)
  pagar(
    @Param('idFnApagar', ParseIntPipe) idFnApagar: number,
    @Body() dto: PagarTituloDto,
    @Req() req: Request,
  ) {
    return this.pagamentos.pagar(idFnApagar, dto, usuarioNome(req));
  }

  /**
   * Anexa a nota a um título no IXC.
   *
   * Rota própria, e não um campo da criação da despesa: assim a nota também
   * entra depois, num título que já existe — e uma falha ao subir o arquivo não
   * derruba o lançamento da conta, que é a parte que não dá para refazer.
   */
  @Post('contas-abertas/:idFnApagar/nota')
  @HttpCode(200)
  anexarNota(
    @Param('idFnApagar', ParseIntPipe) idFnApagar: number,
    @Body() dto: AnexarNotaDto,
  ) {
    return this.service.anexarNota(idFnApagar, dto);
  }

  /** As notas que este título já tem no IXC. */
  @Get('contas-abertas/:idFnApagar/notas')
  notas(@Param('idFnApagar', ParseIntPipe) idFnApagar: number) {
    return this.service.notas(idFnApagar);
  }

  /**
   * O conteúdo de uma nota, para a tela abrir numa aba.
   *
   * Vai `inline`, como o documento do RH: PDF e foto se leem no visualizador do
   * navegador, que é melhor do que qualquer coisa que a tela fosse desenhar.
   */
  @Get('contas-abertas/notas/:id/arquivo')
  async arquivoDaNota(
    @Param('id', ParseIntPipe) id: number,
    @Query('extensao') extensao: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const nota = await this.service.baixarNota(id, extensao);
    res.set({
      'Content-Type': nota.tipo,
      'Content-Length': String(nota.conteudo.length),
      'Content-Disposition': `inline; filename="${nota.nome}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(nota.conteudo);
  }

  /** Paga várias de uma vez, todas pela mesma forma. */
  @Post('contas-abertas/pagar-lote')
  @HttpCode(200)
  pagarLote(@Body() dto: PagarLoteDto, @Req() req: Request) {
    return this.pagamentos.pagarEmLote(
      dto.idsFnApagar,
      {
        contaPagamento: dto.contaPagamento,
        data: dto.data,
        jaSaiu: dto.jaSaiu,
        desconto: dto.desconto,
      },
      usuarioNome(req),
    );
  }

  /** Muda o que dá para mudar num título ainda em aberto. */
  @Patch('contas-abertas/:idFnApagar')
  @HttpCode(200)
  editar(
    @Param('idFnApagar', ParseIntPipe) idFnApagar: number,
    @Body() dto: EditarTituloDto,
  ) {
    return this.pagamentos.editar(idFnApagar, dto);
  }

  /** Apaga vários títulos de uma vez — só os que não foram pagos. */
  @Post('contas-abertas/excluir-lote')
  @HttpCode(200)
  excluirLote(@Body() dto: ExcluirLoteDto) {
    return this.pagamentos.excluirEmLote(dto.idsFnApagar);
  }

  /** Apaga o título no IXC — só o que ainda não foi pago. */
  @Delete('contas-abertas/:idFnApagar')
  @HttpCode(200)
  excluir(@Param('idFnApagar', ParseIntPipe) idFnApagar: number) {
    return this.pagamentos.excluir(idFnApagar);
  }

  /**
   * Fornecedores do IXC que casam com o que foi digitado — razão social, nome
   * fantasia ou CPF/CNPJ.
   */
  @Get('fornecedores-ixc')
  buscarFornecedores(@Query('busca') busca?: string) {
    return this.fornecedores.buscarNoIxcPorNome(busca ?? '');
  }

  /**
   * Um fornecedor do IXC pelo código, com a aba "Dados bancários" junto.
   *
   * A busca por nome não traz a chave PIX de propósito: ela mora noutra tabela e
   * custa uma consulta por fornecedor, o que numa lista seria uma rajada no IXC.
   * Escolhido um, aí sim vale a consulta — é a chave que de fato paga, e quem
   * lança a conta não deveria ter de ir ao IXC copiá-la à mão.
   */
  @Get('fornecedores-ixc/:id')
  buscarFornecedorPorId(@Param('id', ParseIntPipe) id: number) {
    return this.fornecedores.buscarNoIxcPorId(id);
  }

  /** Cria a conta a pagar no IXC e a etiqueta com a categoria escolhida. */
  /**
   * As despesas que ficaram sem chegar ao IXC. Antes de qualquer rota com
   * parâmetro, para não ser lida como id.
   */
  @Get('contas-abertas/despesas-nao-enviadas')
  naoEnviadas() {
    return this.service.naoEnviadas();
  }

  @Post('contas-abertas/despesa')
  @HttpCode(201)
  lancar(@Body() dto: CriarDespesaDto, @Req() req: Request) {
    // O nome vai junto porque um lançamento já pago dá baixa no IXC, e a baixa
    // é assinada: quem conferir o extrato de lá precisa saber quem a fez.
    return this.service.lancar(dto, usuarioId(req), usuarioNome(req));
  }
}
