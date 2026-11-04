import { Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { BackupService } from './backup.service';

/**
 * O backup do banco inteiro. Só o administrador: o arquivo leva tudo o que o
 * sistema guarda, das senhas cifradas aos documentos do RH.
 */
@Controller('backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  /** Cada tabela com o número de registros de agora. */
  @Roles(UserRole.ADMIN)
  @Get('conferencia')
  conferencia() {
    return this.backup.conferencia();
  }

  /** Os backups desde que a API subiu, e o que está saindo. */
  @Roles(UserRole.ADMIN)
  @Get('andamento')
  andamento() {
    return this.backup.andamento();
  }

  @Roles(UserRole.ADMIN)
  @Post('bilhete')
  @HttpCode(200)
  bilhete(@Req() req: Request) {
    return this.backup.emitirBilhete((req.user as { nome?: string }).nome ?? 'Administrador');
  }

  /**
   * O arquivo. Pública porque o navegador a abre como download, sem o token
   * no cabeçalho — quem autoriza é o bilhete, que só o administrador tira.
   */
  @Public()
  @Get('arquivo')
  async arquivo(@Query('bilhete') bilhete: string, @Res() res: Response): Promise<void> {
    await this.backup.gerar(String(bilhete ?? ''), res);
  }
}
