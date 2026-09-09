import { Module } from '@nestjs/common';
import { IxcModule } from '../ixc/ixc.module';
import { AlmoxarifadoController } from './almoxarifado.controller';
import { EstoqueService } from './estoque.service';
import { FerramentasService } from './ferramentas.service';

/**
 * O almoxarifado: o estoque de material e o caderno de ferramentas.
 *
 * Importa o `IxcModule` porque metade dele é leitura de lá — o saldo por
 * almoxarifado, que continua sendo controlado no IXC. A outra metade, o
 * empréstimo de ferramenta, é só banco: é registro desta casa, e o IXC não tem
 * onde guardá-lo.
 */
@Module({
  imports: [IxcModule],
  controllers: [AlmoxarifadoController],
  providers: [EstoqueService, FerramentasService],
})
export class AlmoxarifadoModule {}
