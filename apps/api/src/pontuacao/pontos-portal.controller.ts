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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import {
  CoordenadorGuard,
  type RequisicaoDoCoordenador,
} from './coordenador.guard';
import {
  EntrarDto,
  FotoDaMinhaPontuacaoDto,
  IdentificarDto,
  LancarPontosDto,
  MinhaPontuacaoDto,
} from './dto/pontuacao.dto';
import { LimiteDeTentativas } from './limite-de-tentativas';
import { type Autor, PontuacaoService } from './pontuacao.service';

function autor(req: RequisicaoDoCoordenador): Autor {
  return { tipo: 'coordenador', id: req.coordenador.id, nome: req.coordenador.nome };
}

/**
 * O portal de pontos: a porta de quem não tem login no sistema.
 *
 * Tudo aqui é público para o guard do sistema. O funcionário entra só com o
 * CPF e vê os próprios pontos; o coordenador entra com CPF e senha e ganha um
 * token do portal, conferido pelo `CoordenadorGuard`.
 *
 * O CPF vai sempre no corpo do pedido, e nunca no endereço: endereço fica
 * escrito em log de servidor e no histórico do navegador.
 */
@Public()
@Controller('pontos')
export class PontosPortalController {
  private readonly limite = new LimiteDeTentativas();

  constructor(private readonly service: PontuacaoService) {}

  @Post('identificar')
  @HttpCode(200)
  identificar(@Body() dto: IdentificarDto, @Req() req: Request) {
    this.limite.conferir(req);
    return this.service.identificar(dto.cpf);
  }

  @Post('entrar')
  @HttpCode(200)
  entrar(@Body() dto: EntrarDto, @Req() req: Request) {
    this.limite.conferir(req);
    return this.service.entrar(dto.cpf, dto.senha);
  }

  /** A tela do funcionário. */
  @Post('minha')
  @HttpCode(200)
  minha(@Body() dto: MinhaPontuacaoDto, @Req() req: Request) {
    this.limite.conferir(req);
    return this.service.visaoDoFuncionario(dto.cpf, dto.competencia);
  }

  /** A foto de um dos pontos da tela do funcionário — só dos dele. */
  @Post('minha/foto')
  @HttpCode(200)
  minhaFoto(@Body() dto: FotoDaMinhaPontuacaoDto, @Req() req: Request) {
    this.limite.conferir(req);
    return this.service.fotoDoFuncionario(dto.cpf, dto.lancamentoId);
  }

  // --- Do coordenador, com o token do portal ---

  @Get('eu')
  @UseGuards(CoordenadorGuard)
  eu(@Req() req: RequisicaoDoCoordenador) {
    return { nome: req.coordenador.nome };
  }

  @Get('painel')
  @UseGuards(CoordenadorGuard)
  painel(@Query('competencia') competencia?: string) {
    return this.service.painel(competencia);
  }

  @Get('funcionarios/:id/lancamentos')
  @UseGuards(CoordenadorGuard)
  lancamentos(
    @Param('id') id: string,
    @Query('competencia') competencia: string | undefined,
    @Req() req: RequisicaoDoCoordenador,
  ) {
    return this.service.lancamentosDe(id, competencia, autor(req));
  }

  @Post('lancamentos')
  @HttpCode(201)
  @UseGuards(CoordenadorGuard)
  lancar(@Body() dto: LancarPontosDto, @Req() req: RequisicaoDoCoordenador) {
    return this.service.lancar(dto, autor(req));
  }

  @Delete('lancamentos/:id')
  @HttpCode(200)
  @UseGuards(CoordenadorGuard)
  async apagar(@Param('id') id: string, @Req() req: RequisicaoDoCoordenador) {
    await this.service.apagar(id, autor(req));
    return { ok: true };
  }

  @Get('lancamentos/:id/foto')
  @UseGuards(CoordenadorGuard)
  foto(@Param('id') id: string) {
    return this.service.fotoDoLancamento(id);
  }

  /** Os motivos de um toque. Quem os cadastra é o ADMIN, por dentro. */
  @Get('motivos')
  @UseGuards(CoordenadorGuard)
  motivos() {
    return this.service.listarMotivos();
  }
}
