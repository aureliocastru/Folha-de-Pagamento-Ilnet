import { Module } from '@nestjs/common';
import { AReceberController } from './a-receber.controller';
import { AReceberService } from './a-receber.service';

/**
 * A aba Controle: quem deve a quem está logado. Só o banco — não fala com o
 * IXC nem soma em lugar nenhum.
 */
@Module({
  controllers: [AReceberController],
  providers: [AReceberService],
})
export class AReceberModule {}
