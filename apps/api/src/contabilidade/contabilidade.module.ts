import { Module } from '@nestjs/common';
import { CaixaModule } from '../caixa/caixa.module';
import { ContasAbertasModule } from '../contas-abertas/contas-abertas.module';
import { IxcModule } from '../ixc/ixc.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfiguracaoService } from './configuracao-tela.service';
import { ConfiguracaoContabilService } from './configuracao.service';
import { ContabilidadeController } from './contabilidade.controller';
import { DiagnosticoService } from './diagnostico.service';
import { LeitorDoPacoteService } from './leitor.service';
import { PacoteZipService } from './pacote-zip.service';
import { PacoteContabilService } from './pacote.service';

/**
 * Contabilidade — o que a contabilidade pede todo mês, reunido num lugar só.
 *
 * O que sai do IXC é lido aqui; o que só existe fora dele (extrato do banco,
 * contrato de empréstimo, relatório da maquininha) entra pela tela; e o mês
 * inteiro sai como um zip.
 *
 * O caixa entra pelo fechamento de caixa, que já sabe o saldo da gaveta e o
 * que foi conferido; as contas a pagar, pelas categorias, pelos cartões e pelo
 * download da nota anexada no título.
 */
@Module({
  imports: [IxcModule, PrismaModule, CaixaModule, ContasAbertasModule],
  controllers: [ContabilidadeController],
  providers: [
    DiagnosticoService,
    ConfiguracaoContabilService,
    ConfiguracaoService,
    LeitorDoPacoteService,
    PacoteContabilService,
    PacoteZipService,
  ],
})
export class ContabilidadeModule {}
