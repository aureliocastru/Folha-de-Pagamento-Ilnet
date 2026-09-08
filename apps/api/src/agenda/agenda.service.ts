import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** O bloco como a tela o recebe. */
export interface AgendaNaTela {
  texto: string;
  /** Quando foi gravado pela última vez, ou null se nunca se escreveu nada. */
  atualizadoEm: string | null;
}

const VAZIA: AgendaNaTela = { texto: '', atualizadoEm: null };

/**
 * O bloco de notas de quem está logado.
 *
 * Duas operações e mais nada: ler o meu, gravar o meu. O id nunca vem do
 * corpo nem da URL — ele vem de quem entrou, e é por isso que não há aqui
 * nenhuma checagem de "esta agenda é sua?": não existe caminho para pedir a
 * agenda de outra pessoa.
 */
@Injectable()
export class AgendaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Quem nunca escreveu não tem linha, e isso não é erro: é o bloco em branco.
   * Criar a linha no primeiro login encheria a tabela de papel vazio.
   */
  async minha(usuarioId: string): Promise<AgendaNaTela> {
    const agenda = await this.prisma.agenda.findUnique({
      where: { usuarioId },
    });
    if (!agenda) return VAZIA;
    return {
      texto: agenda.texto,
      atualizadoEm: agenda.updatedAt.toISOString(),
    };
  }

  /**
   * Grava o bloco inteiro por cima do que estava.
   *
   * É `upsert` porque a linha nasce na primeira vez que a pessoa escreve — e
   * porque duas abas da mesma conta não podem virar duas linhas. A última a
   * gravar ganha: é um papel só, e é o mesmo que aconteceria na mesa.
   */
  async salvar(usuarioId: string, texto: string): Promise<AgendaNaTela> {
    const agenda = await this.prisma.agenda.upsert({
      where: { usuarioId },
      create: { usuarioId, texto },
      update: { texto },
    });
    return {
      texto: agenda.texto,
      atualizadoEm: agenda.updatedAt.toISOString(),
    };
  }
}
