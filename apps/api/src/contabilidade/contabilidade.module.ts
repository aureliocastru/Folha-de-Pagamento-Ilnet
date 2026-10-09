import { Module } from '@nestjs/common';
import { IxcModule } from '../ixc/ixc.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ContabilidadeController } from './contabilidade.controller';
import { DiagnosticoService } from './diagnostico.service';

/**
 * Contabilidade — o que a contabilidade pede todo mês, reunido num lugar só.
 *
 * O que sai do IXC é lido aqui; o que só existe fora dele (extrato do banco,
 * contrato de empréstimo, relatório da maquininha) entra pela tela; e o mês
 * inteiro sai como um zip.
 */
@Module({
  imports: [IxcModule, PrismaModule],
  controllers: [ContabilidadeController],
  providers: [DiagnosticoService],
})
export class ContabilidadeModule {}
