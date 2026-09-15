import { Module } from '@nestjs/common';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { VinculoDoLoginService } from './vinculo-do-login.service';

@Module({
  controllers: [UsuariosController],
  providers: [UsuariosService, VinculoDoLoginService],
  // A tela do colaborador pergunta de quem é o login que entrou.
  exports: [VinculoDoLoginService],
})
export class UsuariosModule {}
