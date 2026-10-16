import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ParcelasService } from './parcelas.service';

/** O que mudou ao escrever o número da nota num título. */
export interface NotaFiscalGravada {
  numero: string | null;
  /** Em quantas outras parcelas da mesma compra ele foi escrito também. */
  parcelas: number;
}

/**
 * O número da nota fiscal de cada título do IXC (`NotaFiscalDoTitulo`).
 *
 * Escrito na conta — ao lançar ou ao editar — e lido pela Contabilidade, que o
 * põe ao lado de cada pagamento. Numa compra parcelada a nota é uma só, e por
 * isso ele vai para as outras parcelas também.
 */
@Injectable()
export class NotasFiscaisService {
  private readonly logger = new Logger(NotasFiscaisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parcelas: ParcelasService,
  ) {}

  async doTitulo(idFnApagar: number): Promise<{ numero: string | null }> {
    const nota = await this.prisma.notaFiscalDoTitulo.findUnique({
      where: { idFnApagar },
      select: { numero: true },
    });
    return { numero: nota?.numero ?? null };
  }

  /**
   * O número das contas que acabaram de ser lançadas — todas as parcelas da
   * mesma compra, que aqui se sabe quais são sem precisar deduzir nada.
   */
  async noLancamento(
    titulos: Array<number | null>,
    numero: string | undefined,
    usuario?: string,
  ): Promise<void> {
    const limpo = numero?.trim();
    const ids = titulos.filter((id): id is number => id !== null);
    if (!limpo || ids.length === 0) return;
    const [primeiro] = ids;
    for (const id of ids) {
      await this.gravar(id, limpo, id === primeiro ? null : primeiro, usuario);
    }
  }

  /**
   * Escreve (ou apaga, com vazio) o número de um título, e o leva às outras
   * parcelas da mesma compra.
   *
   * Nas irmãs, só onde não havia número ou havia o mesmo que este tinha: uma
   * parcela que já tem a sua nota não é sobrescrita por um palpite de
   * agrupamento.
   */
  async definir(
    idFnApagar: number,
    numero: string | null | undefined,
    usuario?: string,
  ): Promise<NotaFiscalGravada> {
    const limpo = numero?.trim() || null;
    const antes = (await this.doTitulo(idFnApagar)).numero;
    if (limpo === antes) return { numero: limpo, parcelas: 0 };

    await this.gravar(idFnApagar, limpo, null, usuario);

    let irmas: number[] = [];
    try {
      irmas = await this.parcelas.irmasDe(idFnApagar);
    } catch (err) {
      // Sem o IXC, as outras parcelas ficam como estão: o número deste título
      // já está gravado, e é o que se pediu primeiro.
      this.logger.warn(
        `Número da nota do título ${idFnApagar} gravado, mas as parcelas ` +
          `irmãs não foram lidas: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (irmas.length === 0) return { numero: limpo, parcelas: 0 };

    const atuais = await this.prisma.notaFiscalDoTitulo.findMany({
      where: { idFnApagar: { in: irmas } },
      select: { idFnApagar: true, numero: true },
    });
    const numeroDe = new Map(atuais.map((n) => [n.idFnApagar, n.numero]));
    const livres = irmas.filter((id) => {
      const dela = numeroDe.get(id) ?? null;
      return dela === null || dela === antes;
    });
    for (const id of livres) await this.gravar(id, limpo, idFnApagar, usuario);
    return { numero: limpo, parcelas: livres.length };
  }

  /** Os números já escritos, para a Contabilidade ler de uma vez. */
  async dosTitulos(ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const notas = await this.prisma.notaFiscalDoTitulo.findMany({
      where: { idFnApagar: { in: ids } },
      select: { idFnApagar: true, numero: true },
    });
    return new Map(notas.map((n) => [n.idFnApagar, n.numero]));
  }

  private async gravar(
    idFnApagar: number,
    numero: string | null,
    copiadoDe: number | null,
    usuario?: string,
  ): Promise<void> {
    if (numero === null) {
      await this.prisma.notaFiscalDoTitulo.deleteMany({ where: { idFnApagar } });
      return;
    }
    const dados = { numero, copiadoDe, atualizadoPor: usuario ?? null };
    await this.prisma.notaFiscalDoTitulo.upsert({
      where: { idFnApagar },
      create: { idFnApagar, ...dados },
      update: dados,
    });
  }
}
