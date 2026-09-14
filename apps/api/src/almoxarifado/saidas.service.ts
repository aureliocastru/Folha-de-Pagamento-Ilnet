import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type SaidaDeEstoque } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlmoxarifadosService } from './almoxarifados.service';
import { hojeParaIxc } from './produtos-ixc';
import { ProdutosService } from './produtos.service';

interface Quem {
  nome: string;
}

/** Uma saída como a tela a mostra. */
export interface SaidaNaTela {
  id: string;
  data: string;
  quantidade: number;
  unidade: string | null;
  almoxarifado: string;
  destino: string;
  quemPegou: string;
  observacao: string | null;
  transferenciaIxcId: number | null;
  registradoPor: string;
}

/** O histórico de um produto, e os nomes já usados — para o campo sugerir. */
export interface HistoricoDeSaidas {
  saidas: SaidaNaTela[];
  destinos: string[];
  pessoas: string[];
}

/**
 * A saída de material: 1 bucha 6 que foi para a obra, e quem a levou.
 *
 * O saldo é do IXC, e é lá que ele sai — por transferência do almoxarifado de
 * onde o material foi pego para o almoxarifado "Saídas" (ver
 * `AlmoxarifadosService.almoxDeSaidas`), que não soma no que a casa tem. É o
 * mesmo caminho que a conferência usa para Perdas e Falhas, e o único
 * documentado que tira saldo sem nota fiscal de venda.
 *
 * O que o IXC não tem onde escrever — pra onde foi, quem pegou, a observação —
 * fica aqui, e é o histórico do produto.
 */
@Injectable()
export class SaidasService {
  private readonly logger = new Logger(SaidasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly produtos: ProdutosService,
    private readonly almoxarifados: AlmoxarifadosService,
  ) {}

  async darSaida(
    produtoId: number,
    dados: {
      almoxId: number;
      quantidade: number;
      destino: string;
      quemPegou: string;
      observacao?: string;
    },
    quem: Quem,
  ): Promise<SaidaNaTela> {
    const destino = dados.destino.trim();
    const quemPegou = dados.quemPegou.trim();
    const observacao = dados.observacao?.trim() || null;

    const produto = await this.produtos.detalhar(produtoId);
    // Inativo não existe para o almoxarifado — nem para sair.
    if (!produto.ativo) {
      throw new BadRequestException(`"${produto.descricao}" está inativo no IXC.`);
    }
    if (produto.tipo.trim().toUpperCase() === 'P') {
      throw new BadRequestException(
        `"${produto.descricao}" é patrimônio, que anda peça por peça (MAC, número). ` +
          'Use a tela Transferir para ele.',
      );
    }
    const origem = produto.saldos.find((s) => s.almoxId === dados.almoxId);
    if (!origem || origem.perdas || origem.saidas) {
      throw new BadRequestException(
        `"${produto.descricao}" não tem saldo nesse almoxarifado para sair.`,
      );
    }

    const filialId = await this.filialDe(dados.almoxId);
    const saidas = await this.almoxarifados.almoxDeSaidas(filialId, quem);

    const { transferenciaId } = await this.produtos.transferir(
      produtoId,
      {
        de: dados.almoxId,
        para: saidas.id,
        quantidade: dados.quantidade,
        // A observação inteira fica aqui; no IXC vai o bastante para achar a saída.
        observacao: (
          `Saída para ${destino}, pegou ${quemPegou}` + (observacao ? ` (${observacao})` : '')
        ).slice(0, 200),
      },
      quem,
    );

    // O dia de Brasília, o mesmo da transferência: às 22h daqui o servidor já está amanhã.
    const [dia, mes, ano] = hojeParaIxc().split('/').map(Number);
    const gravada = await this.prisma.saidaDeEstoque.create({
      data: {
        produtoId,
        descricao: produto.descricao,
        unidade: produto.unidade,
        almoxId: dados.almoxId,
        almoxarifado: origem.almoxarifado,
        quantidade: new Prisma.Decimal(dados.quantidade),
        destino,
        quemPegou,
        observacao,
        data: new Date(Date.UTC(ano, mes - 1, dia)),
        transferenciaIxcId: transferenciaId,
        registradoPor: quem.nome,
      },
    });

    this.logger.log(
      `${quem.nome} deu saída de ${dados.quantidade} de "${produto.descricao}" de ` +
        `${origem.almoxarifado} para ${destino} (pegou ${quemPegou}; transferência #${transferenciaId}).`,
    );
    return naTela(gravada);
  }

  async historico(produtoId: number): Promise<HistoricoDeSaidas> {
    const [saidas, recentes] = await Promise.all([
      this.prisma.saidaDeEstoque.findMany({
        where: { produtoId },
        orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
        take: 500,
      }),
      // Os nomes das últimas saídas de qualquer produto: quem pega material é
      // quase sempre a mesma meia dúzia de pessoas, indo aos mesmos lugares.
      this.prisma.saidaDeEstoque.findMany({
        orderBy: { createdAt: 'desc' },
        select: { destino: true, quemPegou: true },
        take: 300,
      }),
    ]);
    return {
      saidas: saidas.map(naTela),
      destinos: unicos(recentes.map((r) => r.destino)),
      pessoas: unicos(recentes.map((r) => r.quemPegou)),
    };
  }

  private async filialDe(almoxId: number): Promise<number> {
    const [, almoxarifados] = await this.produtos.paraMovimentar();
    const almox = almoxarifados.find((a) => a.id === almoxId);
    if (!almox) {
      throw new BadRequestException(
        'O sistema não enxerga esse almoxarifado no IXC — é de técnico e não está liberado. ' +
          'Libere na aba Almoxarifados e tente de novo.',
      );
    }
    return almox.filialId;
  }
}

function naTela(s: SaidaDeEstoque): SaidaNaTela {
  return {
    id: s.id,
    data: s.data.toISOString(),
    quantidade: Number(s.quantidade),
    unidade: s.unidade,
    almoxarifado: s.almoxarifado,
    destino: s.destino,
    quemPegou: s.quemPegou,
    observacao: s.observacao,
    transferenciaIxcId: s.transferenciaIxcId,
    registradoPor: s.registradoPor,
  };
}

/** Sem repetir, sem diferença de maiúscula, na ordem em que apareceram (o mais recente primeiro). */
function unicos(nomes: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const nome of nomes) {
    const chave = nome.trim().toLocaleLowerCase('pt-BR');
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(nome.trim());
  }
  return saida.slice(0, 30);
}
