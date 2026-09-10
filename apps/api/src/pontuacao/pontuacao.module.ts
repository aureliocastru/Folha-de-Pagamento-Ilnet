import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { AppConfig } from '../config/configuration';
import { CoordenadorGuard } from './coordenador.guard';
import { PontosPortalController } from './pontos-portal.controller';
import { PontuacaoController } from './pontuacao.controller';
import { PontuacaoService } from './pontuacao.service';

/**
 * A pontuação dos funcionários: o portal de CPF (`/pontos`) e a visão do
 * ADMIN por dentro do sistema (`/pontuacao`).
 *
 * O JWT daqui é outro, com chave derivada da do sistema. O token do
 * coordenador não pode abrir o sistema, e o `JwtStrategy` de lá recusaria um
 * token assinado com esta chave de qualquer jeito — a separação vale nos dois
 * sentidos.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const jwt = config.getOrThrow<AppConfig['jwt']>('jwt');
        return {
          secret: `${jwt.secret}::pontuacao`,
          signOptions: { expiresIn: '12h' },
        };
      },
    }),
  ],
  controllers: [PontosPortalController, PontuacaoController],
  providers: [PontuacaoService, CoordenadorGuard],
})
export class PontuacaoModule {}
