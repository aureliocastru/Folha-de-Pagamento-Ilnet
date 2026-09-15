import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { LimiteDeTentativas } from '../pontuacao/limite-de-tentativas';
import { AbastecimentosService } from './abastecimentos.service';
import { LancarAbastecimentoDto, VeiculosDoCpfDto } from './dto/veiculo.dto';

/**
 * O abastecimento no portal do CPF — a mesma porta da pontuação.
 *
 * Quem abastece não tem login no sistema: entra com o CPF, vê os veículos que
 * estão no nome dele e lança o abastecimento com o km e a foto da nota. O CPF
 * vai no corpo, nunca no endereço, e o teto de tentativas é o mesmo do portal.
 */
@Public()
@Controller('pontos/abastecimento')
export class AbastecimentoPortalController {
  private readonly limite = new LimiteDeTentativas();

  constructor(private readonly service: AbastecimentosService) {}

  @Post('veiculos')
  @HttpCode(200)
  veiculos(@Body() dto: VeiculosDoCpfDto, @Req() req: Request) {
    this.limite.conferir(req);
    return this.service.doPortal(dto.cpf);
  }

  @Post()
  @HttpCode(201)
  lancar(@Body() dto: LancarAbastecimentoDto, @Req() req: Request) {
    this.limite.conferir(req);
    return this.service.lancarPeloPortal(dto.cpf, dto);
  }
}
