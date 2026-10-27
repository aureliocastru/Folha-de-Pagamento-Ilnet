import { Module } from '@nestjs/common';
import { DiaristasModule } from '../diaristas/diaristas.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { AssinaturasController } from './assinaturas.controller';
import { AssinaturasService } from './assinaturas.service';

@Module({
  imports: [FinanceiroModule, DiaristasModule],
  controllers: [AssinaturasController],
  providers: [AssinaturasService],
  exports: [AssinaturasService],
})
export class AssinaturasModule {}
