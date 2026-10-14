import { Module } from '@nestjs/common';
import { DiaristasModule } from '../diaristas/diaristas.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { ContratosDePatrocinioService } from './contratos.service';
import { AssinarContratoController, PatrocinioController } from './patrocinio.controller';
import { PatrocinioService } from './patrocinio.service';

@Module({
  // `DiaristasModule` porque o patrocinado recebe por um cadastro de diarista,
  // e o cadastro novo nasce pelo mesmo caminho da aba Diaristas (com o
  // fornecedor no IXC). `FinanceiroModule` dá o nome e o CNPJ da empresa que
  // vão no cabeçalho do contrato.
  imports: [DiaristasModule, FinanceiroModule],
  controllers: [PatrocinioController, AssinarContratoController],
  providers: [PatrocinioService, ContratosDePatrocinioService],
})
export class PatrocinioModule {}
