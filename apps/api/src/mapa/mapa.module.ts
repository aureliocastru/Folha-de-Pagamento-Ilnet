import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { IxcModule } from '../ixc/ixc.module';
import { OsModule } from '../os/os.module';
import { MapaController } from './mapa.controller';
import { MapaService } from './mapa.service';
import { criarRastreioHttp, RASTREIO_HTTP, RastreamentoClient } from './rastreamento.client';

/**
 * Mapa de serviço: as OS abertas do IXC e a frota em tempo real, no mesmo
 * mapa. Era o ILNET Service Map, um painel à parte com login próprio; aqui é
 * um módulo, com o login e o acesso da casa.
 *
 * `OsModule` pelas leituras de OS que já existem — o nome dos assuntos e a
 * cidade com a UF, guardados lá.
 */
@Module({
  imports: [IxcModule, OsModule],
  controllers: [MapaController],
  providers: [
    {
      provide: RASTREIO_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        criarRastreioHttp(config.getOrThrow<AppConfig['rastreio']>('rastreio')),
    },
    RastreamentoClient,
    MapaService,
  ],
})
export class MapaModule {}
