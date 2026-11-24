import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { OsModule } from '../os/os.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RhModule } from '../rh/rh.module';
import { AprController } from './apr.controller';
import { AprService } from './apr.service';
import { CatalogoAprService } from './catalogo.service';

/**
 * Segurança do Trabalho — a análise de risco de cada serviço.
 *
 * Dois vizinhos entram aqui, e por motivos pequenos e concretos. Do
 * `FinanceiroModule` vem só a configuração da empresa: é dela que saem a razão
 * social e o CNPJ impressos no alto do papel, e é a mesma que já timbra o
 * recibo da diária — duas fontes para o mesmo dado seria a segunda ficando
 * desatualizada. Do `RhModule` vem a estante: a APR liberada é documento da
 * casa, e a casa já tem um lugar onde se procura documento.
 *
 * E a OS: a APR vem com a ordem de serviço do IXC (pedido de 24/11/2026). Do
 * `OsModule` vem a conferência de que a OS é do técnico; do `IxcModule`, o
 * anexo do PDF na aba "Arquivos" dela. O caminho é só este — o `OsModule` lê
 * a tabela das APRs pelo banco, e não importa este módulo de volta.
 */
@Module({
  imports: [PrismaModule, FinanceiroModule, RhModule, IxcModule, OsModule],
  controllers: [AprController],
  providers: [AprService, CatalogoAprService],
  exports: [AprService],
})
export class AprModule {}
