import { Module } from '@nestjs/common';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';

/**
 * O bloco de notas de cada login. Só o banco: não fala com o IXC e não depende
 * de nenhum outro módulo — é papel de recado, e não registro da empresa.
 */
@Module({
  controllers: [AgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
