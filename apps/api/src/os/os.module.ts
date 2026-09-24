import { Module } from '@nestjs/common';
import { AlmoxarifadoModule } from '../almoxarifado/almoxarifado.module';
import { IxcModule } from '../ixc/ixc.module';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { MateriaisDeOsService } from './materiais.service';
import { MinhasOsController } from './minhas-os.controller';
import { OsDoIxcService } from './os-do-ixc.service';
import { OsController } from './os.controller';
import { OsService } from './os.service';
import { RecolhidosService } from './recolhidos.service';
import { RelatorioOsService } from './relatorio.service';
import { TecnicosService } from './tecnicos.service';

/**
 * Ordens de serviço: o que o técnico instala, retira e gasta em cada OS do
 * IXC, escrito na própria OS e saindo da van dele.
 *
 * Integrado ao almoxarifado pelos serviços de lá — o estoque, a peça bipada, o
 * comodato, a transferência —, e não por cópia: o saldo é um só, o do IXC. O
 * `UsuariosModule` entra pelo vínculo do login com o cadastro, que é como se
 * sabe quem é o técnico.
 */
@Module({
  imports: [IxcModule, AlmoxarifadoModule, UsuariosModule],
  controllers: [MinhasOsController, OsController],
  providers: [
    OsDoIxcService,
    TecnicosService,
    OsService,
    RecolhidosService,
    MateriaisDeOsService,
    RelatorioOsService,
  ],
})
export class OsModule {}
