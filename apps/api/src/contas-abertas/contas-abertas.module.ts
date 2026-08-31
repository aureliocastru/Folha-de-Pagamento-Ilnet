import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { BaixasDoIxcService } from './baixas-do-ixc.service';
import { CategoriasController } from './categorias.controller';
import { CategoriasService } from './categorias.service';
import { ContasAbertasController } from './contas-abertas.controller';
import { ContasAbertasService } from './contas-abertas.service';
import { ContasContratoController } from './contas-contrato.controller';
import { ContasContratoService } from './contas-contrato.service';
import { DespesasController } from './despesas.controller';
import { DespesasService } from './despesas.service';
import { HistoricoPagamentosController } from './historico-pagamentos.controller';
import { HistoricoPagamentosService } from './historico-pagamentos.service';
import { PagamentosService } from './pagamentos.service';
import { ParcelasService } from './parcelas.service';
import { RecorrentesPollerService } from './recorrentes-poller.service';
import { RecorrentesController } from './recorrentes.controller';
import { RecorrentesService } from './recorrentes.service';

@Module({
  // O financeiro entra por causa da despesa lançada à mão: ela vira conta a
  // pagar pelo mesmo motor da folha (ContasPagarService) e precisa achar o
  // fornecedor no IXC (FornecedorService).
  imports: [IxcModule, FinanceiroModule],
  controllers: [
    ContasAbertasController,
    CategoriasController,
    DespesasController,
    RecorrentesController,
    // As contas de energia dos endereços: o cadastro e o botão que faz a
    // fatura do mês virar conta a pagar.
    ContasContratoController,
    // As duas metades da mesma tabela do IXC: o que a empresa deve, e o
    // histórico do que ela já pagou.
    HistoricoPagamentosController,
  ],
  providers: [
    ContasAbertasService,
    CategoriasService,
    DespesasService,
    // `PagamentosService` *paga* (aprova e dá baixa no IXC);
    // `HistoricoPagamentosService` só *lê* o que já foi pago. Nomes parecidos,
    // lados opostos: um escreve no IXC, o outro nunca.
    PagamentosService,
    HistoricoPagamentosService,
    // A linha de baixa do IXC, que é quem sabe em que dia o dinheiro saiu — o
    // título só sabe em que dia a baixa foi registrada.
    BaixasDoIxcService,
    // Que títulos são parcelas da mesma compra. O IXC não guarda esse vínculo:
    // aqui ele é inferido, e a tela diz que é inferência.
    ParcelasService,
    RecorrentesService,
    RecorrentesPollerService,
    // Parecida com a recorrente, e diferente no que importa: aqui o valor não
    // se sabe antes de a fatura chegar, então nada é gerado sozinho.
    ContasContratoService,
  ],
  // O fechamento de caixa lanca a despesa do dinheiro que voltou da rua pelo
  // mesmo caminho desta tela: mesma auditoria, mesma baixa, mesmo titulo no
  // IXC. Um segundo caminho para criar conta a pagar seria um segundo lugar
  // para ele quebrar.
  // `PagamentosService` vai junto porque desfazer um acerto da rua apaga no
  // IXC o título que ele criou: sem isso a saída ficaria viva lá, descontando
  // um dinheiro que ninguém compensa deste lado.
  exports: [DespesasService, PagamentosService],
})
export class ContasAbertasModule {}
