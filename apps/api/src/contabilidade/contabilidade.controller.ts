import { Controller, Get, Param, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  DiagnosticoService,
  type PedidoDeDiagnostico,
} from './diagnostico.service';

/**
 * Contabilidade — o pacote do mês que vai para o escritório de contabilidade.
 *
 * Só ADMIN: o que passa por aqui é o extrato de todas as contas, o que cada
 * cliente deve e quanto os sócios retiraram. Não é assunto de perfil nenhum
 * além de quem responde pela empresa.
 */
@Roles(UserRole.ADMIN)
@Controller('contabilidade')
export class ContabilidadeController {
  constructor(private readonly diagnostico: DiagnosticoService) {}

  /** Uma página crua de uma tabela do IXC, para conferir um relatório. */
  @Get('diagnostico/:tabela')
  lerTabela(
    @Param('tabela') tabela: string,
    @Query() pedido: PedidoDeDiagnostico,
  ) {
    return this.diagnostico.ler(tabela, pedido);
  }
}
