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
import { OrigemLancamento } from '@prisma/client';
import type { Request } from 'express';
import { AvulsosService } from './avulsos.service';
import {
  CriarBeneficiarioDto,
  EditarFornecedorIxcDto,
  PagarAvulsoDto,
  QueryFornecedorIxcDto,
  QueryPagamentosAvulsosDto,
  UpdateBeneficiarioDto,
  VincularFornecedorIxcDto,
} from './dto/avulso.dto';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/**
 * De qual módulo a tela está perguntando.
 *
 * O padrão é a folha, e de propósito: quem não disser nada vê o que sempre viu.
 * Só a tela de Contas a Pagar manda `modulo=contas-pagar`, e é ela que enxerga
 * os cadastros e pagamentos daquele lado.
 */
function origemDoModulo(modulo?: string): OrigemLancamento {
  return modulo === 'contas-pagar'
    ? OrigemLancamento.CONTAS_PAGAR
    : OrigemLancamento.FOLHA;
}

@Controller('avulsos')
export class AvulsosController {
  constructor(private readonly service: AvulsosService) {}

  // --- Cadastro ---
  @Get('beneficiarios')
  listarBeneficiarios(
    @Query('busca') busca?: string,
    @Query('todos') todos?: string,
    @Query('modulo') modulo?: string,
  ) {
    return this.service.listarBeneficiarios(
      busca,
      todos === 'true',
      origemDoModulo(modulo),
    );
  }

  /**
   * O cadastro de fornecedores do IXC, em páginas — é por ele que a tela de
   * Contas a Pagar abre, para pagar quem já existe lá sem cadastrar de novo.
   */
  @Get('fornecedores-ixc')
  listarFornecedoresDoIxc(
    @Query('busca') busca?: string,
    @Query('page') page?: string,
    @Query('porPagina') porPagina?: string,
  ) {
    return this.service.listarFornecedoresDoIxc({
      busca,
      page: Number(page) || 1,
      porPagina: Number(porPagina) || 25,
    });
  }

  /**
   * Muda o cadastro do fornecedor lá no IXC — hoje, o nome fantasia.
   *
   * Escreve num registro que não nasceu aqui, e é essa a intenção: o apelido
   * pelo qual a pessoa é conhecida faltava no cadastro dela, e passar a
   * preenchê-lo daqui evita abrir o IXC só para isso.
   */
  @Patch('fornecedores-ixc/:id')
  @HttpCode(200)
  editarFornecedorDoIxc(
    @Param('id') id: string,
    @Body() dto: EditarFornecedorIxcDto,
  ) {
    return this.service.editarFornecedorDoIxc(Number(id), dto);
  }

  /** O cadastro daqui para um fornecedor do IXC — cria na primeira vez. */
  @Post('beneficiarios/do-ixc')
  @HttpCode(200)
  garantirDoIxc(@Body() dto: VincularFornecedorIxcDto) {
    return this.service.garantirBeneficiarioDoIxc(
      dto.idFornecedorIxc,
      origemDoModulo(dto.modulo),
    );
  }

  /**
   * O que já existe com aquele CPF/CNPJ, aqui e no IXC — para a tela poder
   * perguntar se é para reaproveitar o fornecedor ou criar um novo.
   */
  @Get('consultar-documento')
  consultarDocumento(@Query() q: QueryFornecedorIxcDto) {
    return this.service.consultarCpfCnpj(q.cpfCnpj);
  }

  @Post('beneficiarios')
  @HttpCode(201)
  criarBeneficiario(@Body() dto: CriarBeneficiarioDto) {
    return this.service.criarBeneficiario(dto);
  }

  @Get('beneficiarios/:id')
  buscar(@Param('id') id: string) {
    return this.service.buscar(id);
  }

  @Patch('beneficiarios/:id')
  atualizar(@Param('id') id: string, @Body() dto: UpdateBeneficiarioDto) {
    return this.service.atualizarBeneficiario(id, dto);
  }

  @Delete('beneficiarios/:id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.service.removerBeneficiario(id);
    return { ok: true };
  }

  // --- Pagamentos ---
  @Get('pagamentos')
  listarPagamentos(@Query() q: QueryPagamentosAvulsosDto) {
    return this.service.listarPagamentos(
      q.beneficiarioId,
      origemDoModulo(q.modulo),
    );
  }

  /** Paga alguém de fora da folha: conta a pagar no IXC ou saída do caixa. */
  @Post('beneficiarios/:id/pagamentos')
  @HttpCode(201)
  pagar(
    @Param('id') id: string,
    @Body() dto: PagarAvulsoDto,
    @Req() req: Request,
  ) {
    // Sem `modulo` no corpo, o serviço cai na regra antiga (a origem do
    // cadastro). É por isso que aqui não se usa o padrão de `origemDoModulo`.
    return this.service.pagar(
      id,
      dto,
      usuarioId(req),
      dto.modulo ? origemDoModulo(dto.modulo) : undefined,
    );
  }

  /** Tenta de novo a saída no caixa do IXC. */
  @Post('pagamentos/:id/lancar-caixa')
  @HttpCode(200)
  lancarCaixa(@Param('id') id: string) {
    return this.service.lancarNoCaixa(id);
  }

  /** Alguém lançou no IXC à mão: fecha a pendência. */
  @Post('pagamentos/:id/marcar-lancado')
  @HttpCode(200)
  marcarLancado(@Param('id') id: string) {
    return this.service.marcarLancadoManual(id);
  }

  @Delete('pagamentos/:id')
  @HttpCode(200)
  async removerPagamento(@Param('id') id: string) {
    await this.service.removerPagamento(id);
    return { ok: true };
  }
}
