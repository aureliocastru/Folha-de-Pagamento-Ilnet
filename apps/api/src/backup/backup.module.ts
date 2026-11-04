import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

/** O banco inteiro num arquivo, para guardar ou levar a outro servidor. */
@Module({
  imports: [PrismaModule],
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
