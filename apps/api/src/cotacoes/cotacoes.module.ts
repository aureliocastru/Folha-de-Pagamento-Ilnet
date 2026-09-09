import { Module } from '@nestjs/common';
import { CotacoesController } from './cotacoes.controller';
import { CotacoesService } from './cotacoes.service';
import { FornecedoresCotacaoService } from './fornecedores-cotacao.service';

/**
 * Cotações de preços: o que a casa compra, e por quanto, em cada fornecedor.
 *
 * Só o banco. **Não importa o `IxcModule`**, e isso não é esquecimento: o
 * fornecedor daqui é cadastro desta casa, um por um, e não tem nada a ver com
 * os três mil e duzentos do IXC — aqueles respondem "para quem já pagamos?",
 * e este módulo responde "quanto custa a ONU, e onde?".
 */
@Module({
  controllers: [CotacoesController],
  providers: [CotacoesService, FornecedoresCotacaoService],
})
export class CotacoesModule {}
