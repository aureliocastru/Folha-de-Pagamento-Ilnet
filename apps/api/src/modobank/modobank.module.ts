import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { ModobankClient } from './modobank.client';

/** A API do ModoBank. Sem a credencial no ambiente, sobe do mesmo jeito. */
@Module({
  providers: [
    {
      provide: ModobankClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new ModobankClient(config.getOrThrow<AppConfig['modobank']>('modobank')),
    },
  ],
  exports: [ModobankClient],
})
export class ModobankModule {}
