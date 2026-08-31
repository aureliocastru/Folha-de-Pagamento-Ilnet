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
import {
  AnexarNotaDto,
  ConferirLancamentoDto,
  ContagemDaGavetaDto,
  EntregarDinheiroDto,
  FecharCaixaDto,
  ForaDaGavetaDto,
  MovimentoDaRuaDto,
  NotaDto,
  PeriodoDoCaixaDto,
} from './dto/caixa.dto';
import { FechamentoCaixaService } from './fechamento-caixa.service';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/** A baixa no IXC é assinada: quem conferir o extrato de lá precisa saber quem. */
function usuarioNome(req: Request): string | undefined {
  return (req.user as { nome?: string } | undefined)?.nome;
}

/** Bater o caixa do dinheiro em mãos: conferir, fotografar a nota, fechar. */
@Controller('caixa')
export class FechamentoCaixaController {
  constructor(private readonly service: FechamentoCaixaService) {}

  /** Os caixas do IXC, para escolher qual bater. */
  @Get('caixas')
  caixas() {
    return this.service.listarCaixas();
  }

  /**
   * Em que tabela do IXC ele foi olhar e que colunas achou. Antes das rotas
   * com parâmetro, para não ser lida como um id de caixa.
   */
  @Get('diagnostico')
  diagnostico() {
    return this.service.diagnostico();
  }

  /** Os lançamentos do período, com o que já foi conferido e o que está na rua. */
  @Get(':caixaId/extrato')
  extrato(
    @Param('caixaId', ParseIntPipe) caixaId: number,
    @Query() query: PeriodoDoCaixaDto,
  ) {
    return this.service.extrato(caixaId, query.de, query.ate);
  }

  /**
   * Dar por conferido é de ADMIN.
   *
   * A conferência é a assinatura de quem responde pelo caixa — quem opera o
   * dia a dia lança, fotografa e presta contas; quem responde é que diz "olhei
   * tudo". Sem esta linha, o mesmo par de mãos que lança dá o próprio
   * lançamento por conferido, e a conferência deixa de conferir alguma coisa.
   */
  @Put(':caixaId/lancamentos/:idLancamento/conferir')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  conferir(
    @Param('caixaId', ParseIntPipe) caixaId: number,
    @Param('idLancamento', ParseIntPipe) idLancamento: number,
    @Body() dto: ConferirLancamentoDto,
    @Req() req: Request,
  ) {
    return this.service.conferir(caixaId, idLancamento, dto, usuarioId(req));
  }

  /**
   * Tira este lançamento da conta do saldo esperado — ou o devolve a ela.
   *
   * O lançamento continua na lista e na fila de conferência: ele é uma saída
   * que aconteceu. O que ele deixa de fazer é pesar na gaveta.
   */
  @Patch(':caixaId/lancamentos/:idLancamento/fora-da-gaveta')
  foraDaGaveta(
    @Param('caixaId', ParseIntPipe) caixaId: number,
    @Param('idLancamento', ParseIntPipe) idLancamento: number,
    @Body() dto: ForaDaGavetaDto,
    @Req() req: Request,
  ) {
    return this.service.marcarForaDaGaveta(
      caixaId,
      idLancamento,
      dto,
      usuarioId(req),
    );
  }

  /**
   * Anexa mais uma foto à nota. Fotografar não é conferir: quem opera o caixa
   * documenta o que pagou, e é isso que o ADMIN vai olhar depois.
   */
  @Post(':caixaId/lancamentos/:idLancamento/notas')
  @HttpCode(201)
  adicionarNota(
    @Param('caixaId', ParseIntPipe) caixaId: number,
    @Param('idLancamento', ParseIntPipe) idLancamento: number,
    @Body() dto: AnexarNotaDto,
    @Req() req: Request,
  ) {
    return this.service.adicionarNota(
      caixaId,
      idLancamento,
      dto.notaFoto,
      dto,
      usuarioId(req),
    );
  }

  /** As fotos de um lançamento — os números, não as imagens. */
  @Get(':caixaId/lancamentos/:idLancamento/notas')
  notas(
    @Param('caixaId', ParseIntPipe) caixaId: number,
    @Param('idLancamento', ParseIntPipe) idLancamento: number,
  ) {
    return this.service.notas(caixaId, idLancamento);
  }

  // --- Dinheiro na rua ---

  @Post('dinheiro-na-rua')
  @HttpCode(201)
  entregar(@Body() dto: EntregarDinheiroDto, @Req() req: Request) {
    return this.service.entregar(dto, usuarioId(req));
  }

  @Get(':caixaId/dinheiro-na-rua')
  historicoDaRua(@Param('caixaId', ParseIntPipe) caixaId: number) {
    return this.service.historicoDaRua(caixaId);
  }

  /** Um acerto da conta: nota comprovada, troco devolvido ou mais dinheiro. */
  @Post('dinheiro-na-rua/:id/movimento')
  @HttpCode(201)
  lancarMovimento(
    @Param('id') id: string,
    @Body() dto: MovimentoDaRuaDto,
    @Req() req: Request,
  ) {
    return this.service.lancarMovimento(
      id,
      dto,
      usuarioId(req),
      usuarioNome(req),
    );
  }

  /** As fotos de um acerto da rua. */
  @Get('movimentos-da-rua/:id/notas')
  notasDoMovimento(@Param('id') id: string) {
    return this.service.notasDoMovimento(id);
  }

  @Post('movimentos-da-rua/:id/notas')
  @HttpCode(201)
  adicionarNotaAoMovimento(
    @Param('id') id: string,
    @Body() dto: NotaDto,
    @Req() req: Request,
  ) {
    return this.service.adicionarNotaAoMovimento(
      id,
      dto.notaFoto!,
      usuarioId(req),
    );
  }

  /**
   * Uma foto, sob demanda. É aqui que a imagem trafega, e em lugar nenhum
   * mais: antes das rotas com `:caixaId`, para não ser lida como um id.
   */
  @Get('notas/:fotoId')
  foto(@Param('fotoId') fotoId: string) {
    return this.service.foto(fotoId);
  }

  @Delete('notas/:fotoId')
  @HttpCode(200)
  async apagarFoto(@Param('fotoId') fotoId: string) {
    await this.service.apagarFoto(fotoId);
    return { ok: true };
  }

  /** Desfaz um lançamento da conta, apagando junto o título que ele gerou. */
  @Delete('movimentos-da-rua/:id')
  @HttpCode(200)
  async desfazerMovimento(@Param('id') id: string) {
    await this.service.desfazerMovimento(id);
    return { ok: true };
  }

  /** Desfaz o acerto inteiro: a conta volta a ser só a entrega. */
  @Delete('dinheiro-na-rua/:id/acertos')
  @HttpCode(200)
  desfazerAcertos(@Param('id') id: string) {
    return this.service.desfazerAcertos(id);
  }

  @Delete('dinheiro-na-rua/:id')
  @HttpCode(200)
  async apagarEntrega(@Param('id') id: string) {
    await this.service.apagarEntrega(id);
    return { ok: true };
  }

  // --- Fechar ---

  @Post('fechar')
  @HttpCode(201)
  fechar(@Body() dto: FecharCaixaDto, @Req() req: Request) {
    return this.service.fechar(dto, usuarioId(req));
  }

  /** O que já foi conferido neste caixa, com busca — o histórico da tela. */
  @Get(':caixaId/historico')
  historico(
    @Param('caixaId', ParseIntPipe) caixaId: number,
    @Query('busca') busca?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    return this.service.historicoConferido(caixaId, { busca, de, ate });
  }

  @Get(':caixaId/fechamentos')
  fechamentos(@Param('caixaId', ParseIntPipe) caixaId: number) {
    return this.service.listarFechamentos(caixaId);
  }

  /**
   * O que este período fechado tem dentro, completo.
   *
   * Rota própria, e não o `historico` com de/ate, porque só ela pode ler o
   * IXC: as conferências antigas não guardaram data, e sem essa leitura o
   * período diz "133 saídas conferidas" e lista seis. A procura continua sem
   * tocar no IXC, que é o que a mantém rápida.
   */
  @Get('fechamentos/:id/historico')
  historicoDoFechamento(@Param('id') id: string) {
    return this.service.historicoDoFechamento(id);
  }

  /**
   * Corrige o que se contou na gaveta num fechamento já assinado — só no
   * último de cada caixa, que é o único de quem ninguém ainda dependeu.
   */
  @Put('fechamentos/:id/contagem')
  @HttpCode(200)
  corrigirContagem(
    @Param('id') id: string,
    @Body() dto: ContagemDaGavetaDto,
    @Req() req: Request,
  ) {
    return this.service.corrigirContagem(id, dto.saldoContado, usuarioId(req));
  }
}
