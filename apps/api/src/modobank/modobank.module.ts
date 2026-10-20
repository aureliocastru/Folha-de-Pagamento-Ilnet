import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { ModobankClient } from './modobank.client';

/**
 * O recebimento (cash in): o mesmo jeito de falar com o banco, com o
 * certificado e a URL do recebimento. Injetado por este nome.
 */
export const MODOBANK_RECEBER = 'MODOBANK_RECEBER';

/** A API do ModoBank. Sem a credencial no ambiente, sobe do mesmo jeito. */
@Module({
  providers: [
    {
      provide: ModobankClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new ModobankClient(config.getOrThrow<AppConfig['modobank']>('modobank')),
    },
    {
      provide: MODOBANK_RECEBER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new ModobankClient(config.getOrThrow<AppConfig['modobankReceber']>('modobankReceber')),
    },
  ],
  exports: [ModobankClient, MODOBANK_RECEBER],
})
export class ModobankModule {}
