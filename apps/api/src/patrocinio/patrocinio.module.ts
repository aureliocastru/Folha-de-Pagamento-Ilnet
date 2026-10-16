import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { ContratosDePatrocinioService } from './contratos.service';
import { AssinarContratoController, PatrocinioController } from './patrocinio.controller';
import { PatrocinioService } from './patrocinio.service';

@Module({
  // `IxcModule` porque o que já se mandou ao patrocinado é lido dos títulos do
  // fornecedor dele no IXC. `FinanceiroModule` dá a busca de fornecedores e o
  // nome e o CNPJ da empresa que vão no cabeçalho do contrato.
  imports: [IxcModule, FinanceiroModule],
  controllers: [PatrocinioController, AssinarContratoController],
  providers: [PatrocinioService, ContratosDePatrocinioService],
})
export class PatrocinioModule {}
