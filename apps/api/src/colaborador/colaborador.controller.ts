import {
  Body,
  Controller,
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
import { PontuacaoService } from '../pontuacao/pontuacao.service';
import { VinculoDoLoginService } from '../usuarios/vinculo-do-login.service';

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
      veiculos: colaborador ? await this.abastecimentos.quantosVeiculos(colaborador.id) : 0,
    };
  }

  @Get('pontuacao')
  async minhaPontuacao(@Req() req: Request, @Query('competencia') competencia?: string) {
    return this.pontuacao.visaoDoColaborador(await this.quemSou(req), competencia);
  }

  /** A foto de um dos pontos — só dos dele. */
  @Get('pontuacao/:lancamentoId/foto')
  async fotoDosPontos(@Req() req: Request, @Param('lancamentoId') lancamentoId: string) {
    return this.pontuacao.fotoDoLancamento(lancamentoId, await this.quemSou(req));
  }

  @Get('abastecimento')
  async meusVeiculos(@Req() req: Request) {
    return this.abastecimentos.doColaborador(await this.quemSou(req));
  }

  @Post('abastecimento')
  @HttpCode(201)
  async abastecer(@Req() req: Request, @Body() dto: LancarMeuAbastecimentoDto) {
    return this.abastecimentos.lancarPeloColaborador(
      await this.quemSou(req),
      idDoLogado(req),
      dto,
    );
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

function idDoLogado(req: Request): string {
  return (req.user as { id: string }).id;
}
