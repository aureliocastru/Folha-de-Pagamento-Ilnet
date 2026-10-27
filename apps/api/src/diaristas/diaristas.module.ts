import { Module } from '@nestjs/common';
import { ContasAbertasModule } from '../contas-abertas/contas-abertas.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { DiaristasController } from './diaristas.controller';
import { DiaristasService } from './diaristas.service';

@Module({
  // `ContasAbertasModule` entra pelo `PagamentosService`: a diária paga em
  // mãos é aprovada e baixada quando o recibo é assinado, pelo mesmo caminho
  // da despesa que já nasce quitada.
  imports: [IxcModule, FinanceiroModule, ContasAbertasModule],
  controllers: [DiaristasController],
  providers: [DiaristasService],
  // Quem guarda a assinatura é quem avisa que a baixa pode sair.
  exports: [DiaristasService],
})
export class DiaristasModule {}
