import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { AlmoxarifadoController } from './almoxarifado.controller';
import { ComodatoService } from './comodato.service';
import { EstoqueService } from './estoque.service';
import { FerramentasService } from './ferramentas.service';
import { ProdutosService } from './produtos.service';

/**
 * O almoxarifado: o estoque de material e o caderno de ferramentas.
 *
 * Importa o `IxcModule` porque metade dele é do IXC — o saldo por
 * almoxarifado, o cadastro de produto, a transferência, a entrada de compra e
 * o comodato. A outra metade, o empréstimo de ferramenta, é só banco: é
 * registro desta casa, e o IXC não tem onde guardá-lo.
 *
 * O `FinanceiroModule` entra pela busca de fornecedor da entrada de compra —
 * o mesmo cadastro de fornecedores do IXC que o contas a pagar usa.
 */
@Module({
  imports: [IxcModule, FinanceiroModule],
  controllers: [AlmoxarifadoController],
  providers: [EstoqueService, FerramentasService, ProdutosService, ComodatoService],
})
export class AlmoxarifadoModule {}
