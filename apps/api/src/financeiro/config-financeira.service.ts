import { Injectable } from '@nestjs/common';
import { ConfiguracaoFinanceira } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateConfigFinanceiraDto } from './dto/update-config.dto';

/** Acesso à parametrização financeira (registro único id=1). */
@Injectable()
export class ConfigFinanceiraService {
  constructor(private readonly prisma: PrismaService) {}

  /** Retorna a config, criando com os padrões se ainda não existir. */
  async obter(): Promise<ConfiguracaoFinanceira> {
    const existente = await this.prisma.configuracaoFinanceira.findUnique({
      where: { id: 1 },
    });
    if (existente) return existente;
    return this.prisma.configuracaoFinanceira.create({ data: { id: 1 } });
  }

  async atualizar(
    dto: UpdateConfigFinanceiraDto,
  ): Promise<ConfiguracaoFinanceira> {
    await this.obter(); // garante existência
    return this.prisma.configuracaoFinanceira.update({
      where: { id: 1 },
      data: dto,
    });
  }

  /**
   * Guarda qual categoria a folha usa.
   *
   * Escrita à parte da tela de Configurações porque quem a chama é o próprio
   * app, ao achar a categoria pelo nome na primeira folha depois desta coluna
   * existir. Achou uma vez, fica sabido.
   */
  async definirCategoriaDaFolha(
    categoriaId: string | null,
  ): Promise<ConfiguracaoFinanceira> {
    await this.obter();
    return this.prisma.configuracaoFinanceira.update({
      where: { id: 1 },
      data: { categoriaFolhaId: categoriaId },
    });
  }

  /**
   * Guarda o que o app descobriu do rádio "Tipo da chave Pix" no IXC.
   *
   * Fica em campo próprio, separado do que se informa em Configurações: o que
   * foi digitado à mão continua mandando, e o aprendizado sobrevive ao
   * reinício da API sem precisar reler as contas antigas do IXC.
   */
  async guardarAprendizadoPix(
    campo: string,
    codigos: string,
  ): Promise<ConfiguracaoFinanceira> {
    await this.obter();
    return this.prisma.configuracaoFinanceira.update({
      where: { id: 1 },
      data: {
        pixCampoTipoChaveAprendido: campo,
        pixCodigosTipoChaveAprendidos: codigos,
      },
    });
  }
}
