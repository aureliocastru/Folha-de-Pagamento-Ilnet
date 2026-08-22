import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
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
 */
@Module({
  imports: [PrismaModule, FinanceiroModule, RhModule],
  controllers: [AprController],
  providers: [AprService, CatalogoAprService],
  exports: [AprService],
})
export class AprModule {}
