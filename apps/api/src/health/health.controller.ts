import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { LENTO_MS, medidor } from './medidor';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    let db = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'erro';
    }
    return {
      status: db === 'ok' ? 'ok' : 'degradado',
      db,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Onde o sistema gasta tempo, desde que a API subiu: as rotas daqui e os
   * recursos do IXC, as que mais pesam primeiro. Ver o `medidor`.
   */
  @Roles(UserRole.ADMIN)
  @Get('tempos')
  tempos() {
    return {
      desde: medidor.medindoDesde.toISOString(),
      lentoAPartirDeMs: LENTO_MS,
      rotas: medidor.resumo('rota'),
      ixc: medidor.resumo('ixc'),
    };
  }
}
