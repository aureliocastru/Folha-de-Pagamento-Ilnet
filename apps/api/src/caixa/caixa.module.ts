import { Module } from '@nestjs/common';
import { ContasAbertasModule } from '../contas-abertas/contas-abertas.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { FechamentoCaixaController } from './fechamento-caixa.controller';
import { FechamentoCaixaService } from './fechamento-caixa.service';

/**
 * Bater o caixa do dinheiro em mãos.
 *
 * O IXC entra por causa do `CaixaService`, que sabe achar a tabela de
 * movimento e ler os lançamentos; o financeiro, por causa da configuração
 * (qual tabela, qual caixa é o de dinheiro em mãos); as contas em aberto,
 * porque a prestação de contas de quem levou dinheiro lança a despesa como
 * conta a pagar, e ela nasce pelo mesmo motor da tela de lançar despesa.
 */
@Module({
  imports: [IxcModule, FinanceiroModule, ContasAbertasModule],
  controllers: [FechamentoCaixaController],
  providers: [FechamentoCaixaService],
  // A contabilidade lê o caixa físico do mês pelo mesmo extrato desta tela:
  // um segundo jeito de somar a gaveta seria um segundo saldo para ela.
  exports: [FechamentoCaixaService],
})
export class CaixaModule {}
