import { Module } from '@nestjs/common';
import { ContasAbertasModule } from '../contas-abertas/contas-abertas.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { DiaristasController } from './diaristas.controller';
import { DiaristasService } from './diaristas.service';

@Module({
  // `ContasAbertasModule` entra pelo `PagamentosService`: a diária paga em
  // mãos é aprovada e baixada no ato, pelo mesmo caminho da despesa que já
  // nasce quitada.
  imports: [IxcModule, FinanceiroModule, ContasAbertasModule],
  controllers: [DiaristasController],
  providers: [DiaristasService],
})
export class DiaristasModule {}
