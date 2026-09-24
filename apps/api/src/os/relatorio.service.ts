import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { limitesDoMes, montarRelatorio, type RelatorioDoMes } from './relatorio';

/**
 * O relatório do mês, lido do banco daqui — e não do IXC.
 *
 * É esse o ganho de gravar cópia de cada item: varrer o IXC OS por OS, no fim
 * do mês, seriam centenas de consultas para responder o que aqui é uma só.
 * Entra o que foi gravado no IXC dentro do mês (ver `relatorio.ts`).
 */
@Injectable()
export class RelatorioOsService {
  constructor(private readonly prisma: PrismaService) {}

  async doMes(competencia: string): Promise<RelatorioDoMes> {
    let limites: { inicio: Date; fim: Date };
    try {
      limites = limitesDoMes(competencia);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
    const itens = await this.prisma.itemDeOs.findMany({
      where: { situacao: 'GRAVADO', gravadoEm: { gte: limites.inicio, lt: limites.fim } },
      include: {
        tecnico: { select: { nome: true, apelido: true } },
        registro: { select: { osIxcId: true } },
      },
    });
    return montarRelatorio(
      competencia,
      itens.map((i) => ({
        tipo: i.tipo,
        tecnicoId: i.tecnicoId,
        tecnico: i.tecnico.apelido || i.tecnico.nome,
        osIxcId: i.registro.osIxcId,
        produtoId: i.produtoId,
        descricao: i.descricao,
        unidade: i.unidade,
        quantidade: Number(i.quantidade),
        valorUnitario: i.valorUnitario === null ? null : Number(i.valorUnitario),
        condicao: i.condicao,
        observacao: i.observacao,
      })),
    );
  }
}
