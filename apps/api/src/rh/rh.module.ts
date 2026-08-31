import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConversaoPdfService } from './conversao-pdf.service';
import { DocumentosRhService } from './documentos.service';
import { LicitacoesService } from './licitacoes.service';
import { PastaEmZipService } from './pasta-em-zip.service';
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
  providers: [
    DocumentosRhService,
    RecibosDaFolhaService,
    LicitacoesService,
    // O Word virando PDF ao ser guardado. Mora aqui porque é da estante: é
    // guardando o papel que se decide em que formato ele fica.
    ConversaoPdfService,
    // A pasta saindo daqui como um arquivo só.
    PastaEmZipService,
  ],
  exports: [DocumentosRhService],
})
export class RhModule {}
