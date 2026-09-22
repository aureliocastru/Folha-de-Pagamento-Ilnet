import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { AbastecimentosService } from '../contas-abertas/abastecimentos.service';
import { LancarMeuAbastecimentoDto } from '../contas-abertas/dto/veiculo.dto';
import { LancarPontosDto } from '../pontuacao/dto/pontuacao.dto';
import { type Autor, PontuacaoService } from '../pontuacao/pontuacao.service';
import { VinculoDoLoginService } from '../usuarios/vinculo-do-login.service';
import type { AreaDoColaborador } from './areas';

/**
 * A tela do colaborador: o que é da pessoa que entrou, e só dela.
 *
 * O mesmo login do sistema, e não um login a mais: quem ela é vem do vínculo
 * do login com o cadastro (ver `VinculoDoLoginService`), e nada aqui recebe o
 * id de um colaborador de fora — não há como pedir os pontos ou o veículo de
 * outra pessoa trocando um número no pedido.
 *
 * Fora dos módulos (`ModulosGuard`) de propósito: a pontuação e o
 * abastecimento de alguém não são assunto da folha nem do contas a pagar. E
 * vale para todo perfil, até para lançar — o Visualizador só lê o que é da
 * empresa, mas o abastecimento do carro que ele dirige é dele. A lista é
 * exaustiva pelo mesmo motivo da troca de senha: um perfil novo não entra por
 * omissão.
 */
@Roles(UserRole.ADMIN, UserRole.RH, UserRole.VISUALIZADOR, UserRole.TECNICO)
@Controller('colaborador')
export class ColaboradorController {
  constructor(
    private readonly vinculos: VinculoDoLoginService,
    private readonly pontuacao: PontuacaoService,
    private readonly abastecimentos: AbastecimentosService,
  ) {}

  /** Quem é o login, e o que a tela inicial dele mostra. */
  @Get()
  async inicio(@Req() req: Request) {
    const colaborador = await this.vinculos.doLogin(idDoLogado(req));
    return {
      colaborador,
      // Os do cadastro e os do login: o dono não é funcionário, e o veículo
      // dele fica no nome do login.
      veiculos: await this.abastecimentos.quantosVeiculos({
        funcionarioId: colaborador?.id ?? null,
        usuarioId: idDoLogado(req),
      }),
      areas: logado(req).minhaArea ?? [],
    };
  }

  @Get('pontuacao')
  async minhaPontuacao(@Req() req: Request, @Query('competencia') competencia?: string) {
    exigir(req, 'pontuacao');
    return this.pontuacao.visaoDoColaborador(await this.quemSou(req), competencia);
  }

  /** A foto de um dos pontos — só dos dele. */
  @Get('pontuacao/:lancamentoId/foto')
  async fotoDosPontos(@Req() req: Request, @Param('lancamentoId') lancamentoId: string) {
    exigir(req, 'pontuacao');
    return this.pontuacao.fotoDoLancamento(lancamentoId, await this.quemSou(req));
  }

  /*
   * O abastecimento não exige o login ligado a um cadastro, ao contrário da
   * pontuação: o veículo pode estar no nome do próprio login — o do dono, o
   * do administrador, que não são funcionários. Ligado, valem os dois.
   */

  @Get('abastecimento')
  async meusVeiculos(@Req() req: Request) {
    exigir(req, 'abastecimento');
    const colaborador = await this.vinculos.doLogin(idDoLogado(req));
    return this.abastecimentos.doLogin(logado(req), colaborador?.id ?? null);
  }

  @Post('abastecimento')
  @HttpCode(201)
  async abastecer(@Req() req: Request, @Body() dto: LancarMeuAbastecimentoDto) {
    exigir(req, 'abastecimento');
    const colaborador = await this.vinculos.doLogin(idDoLogado(req));
    return this.abastecimentos.lancarPeloLogin(logado(req), colaborador?.id ?? null, dto);
  }

  // --- Pontuar: só o login com "Pontuar" marcado ---
  //
  // O mesmo painel do coordenador do portal, com as mesmas regras; muda só
  // quem assina o lançamento — o login, e não o CPF com senha.

  @Get('pontos/painel')
  painel(@Req() req: Request, @Query('competencia') competencia?: string) {
    this.soCoordenador(req);
    return this.pontuacao.painel(competencia);
  }

  @Get('pontos/funcionarios/:id/lancamentos')
  lancamentos(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('competencia') competencia?: string,
  ) {
    return this.pontuacao.lancamentosDe(id, competencia, this.soCoordenador(req));
  }

  @Post('pontos/lancamentos')
  @HttpCode(201)
  pontuar(@Req() req: Request, @Body() dto: LancarPontosDto) {
    return this.pontuacao.lancar(dto, this.soCoordenador(req));
  }

  @Delete('pontos/lancamentos/:id')
  @HttpCode(200)
  async apagarPontos(@Req() req: Request, @Param('id') id: string) {
    await this.pontuacao.apagar(id, this.soCoordenador(req));
    return { ok: true };
  }

  @Get('pontos/lancamentos/:id/foto')
  fotoDoLancamento(@Req() req: Request, @Param('id') id: string) {
    this.soCoordenador(req);
    return this.pontuacao.fotoDoLancamento(id);
  }

  @Get('pontos/motivos')
  motivos(@Req() req: Request) {
    this.soCoordenador(req);
    return this.pontuacao.listarMotivos();
  }

  /** Quem pontua pelo login: "Pontuar" marcado nos módulos, na tela de Usuários. */
  private soCoordenador(req: Request): Autor {
    exigir(req, 'pontuar');
    const u = logado(req);
    return { tipo: 'login', id: u.id, nome: u.nome };
  }

  private async quemSou(req: Request): Promise<string> {
    const colaborador = await this.vinculos.doLogin(idDoLogado(req));
    if (!colaborador) {
      throw new NotFoundException(
        'Seu login ainda não está ligado ao seu cadastro de funcionário. ' +
          'Peça ao administrador para ligar, na tela de Usuários.',
      );
    }
    return colaborador.id;
  }
}

function logado(req: Request) {
  return req.user as { id: string; nome: string; minhaArea?: string[] };
}

/** A parte da Minha área que o administrador deu a este login. */
function exigir(req: Request, area: AreaDoColaborador): void {
  if (!(logado(req).minhaArea ?? []).includes(area)) {
    const nome = { pontuacao: 'Pontuação', abastecimento: 'Abastecimento', pontuar: 'Pontuar' }[area];
    throw new ForbiddenException(
      `Seu login não abre "${nome}". Peça ao administrador para marcar, nos módulos do seu login.`,
    );
  }
}

function idDoLogado(req: Request): string {
  return logado(req).id;
}
