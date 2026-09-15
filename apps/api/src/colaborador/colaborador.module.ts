import { Module } from '@nestjs/common';
import { ContasAbertasModule } from '../contas-abertas/contas-abertas.module';
import { PontuacaoModule } from '../pontuacao/pontuacao.module';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { ColaboradorController } from './colaborador.controller';

/**
 * A tela do colaborador: a pontuação e o abastecimento de quem entrou com o
 * próprio login. Não tem regra própria — pega emprestado o que o portal do CPF
 * já faz, trocando só o jeito de saber quem é a pessoa.
 */
@Module({
  imports: [UsuariosModule, PontuacaoModule, ContasAbertasModule],
  controllers: [ColaboradorController],
})
export class ColaboradorModule {}
