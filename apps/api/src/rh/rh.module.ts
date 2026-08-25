import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentosRhService } from './documentos.service';
import { LicitacoesService } from './licitacoes.service';
import { RecibosDaFolhaService } from './recibos.service';
import { RhController } from './rh.controller';

/**
 * RH — a pasta onde os documentos da casa ficam.
 *
 * Por enquanto ele guarda e acha: a pasta de cada funcionário, a da empresa, e
 * o PDF de recibos da folha separado por dono. Gerar documento a partir de
 * modelo (contrato, advertência, declaração) é o passo seguinte, e nasce aqui
 * dentro.
 */
@Module({
  imports: [PrismaModule],
  controllers: [RhController],
  providers: [DocumentosRhService, RecibosDaFolhaService, LicitacoesService],
  exports: [DocumentosRhService],
})
export class RhModule {}
