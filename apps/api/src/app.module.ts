import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { configuration } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { IxcModule } from './ixc/ixc.module';
import { SyncModule } from './sync/sync.module';
import { FuncionariosModule } from './funcionarios/funcionarios.module';
import { FinanceiroModule } from './financeiro/financeiro.module';
import { DiaristasModule } from './diaristas/diaristas.module';
import { ImpostosModule } from './impostos/impostos.module';
import { FeriasModule } from './ferias/ferias.module';
import { ValesModule } from './vales/vales.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AssinaturasModule } from './assinaturas/assinaturas.module';
import { ContasAbertasModule } from './contas-abertas/contas-abertas.module';
import { CaixaModule } from './caixa/caixa.module';
import { TransferenciasModule } from './transferencias/transferencias.module';
import { AuthModule } from './auth/auth.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { RhModule } from './rh/rh.module';
import { AprModule } from './apr/apr.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ModulosGuard } from './auth/modulos.guard';
import { RolesGuard } from './auth/roles.guard';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
    }),
    PrismaModule,
    AuthModule,
    UsuariosModule,
    IxcModule,
    SyncModule,
    FuncionariosModule,
    FinanceiroModule,
    DiaristasModule,
    ImpostosModule,
    FeriasModule,
    ValesModule,
    DashboardModule,
    AssinaturasModule,
    ContasAbertasModule,
    CaixaModule,
    TransferenciasModule,
    RhModule,
    AprModule,
  ],
  controllers: [HealthController],
  providers: [
    // Protege todas as rotas por padrão; use @Public() para abrir exceções.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Depois do login, o perfil decide o que dá para fazer. A ordem importa:
    // o JwtAuthGuard precisa ter posto o usuário na requisição antes.
    { provide: APP_GUARD, useClass: RolesGuard },
    // E, por último, onde ela pode fazer: o perfil diz o quê, o módulo diz onde.
    { provide: APP_GUARD, useClass: ModulosGuard },
  ],
})
export class AppModule {}
