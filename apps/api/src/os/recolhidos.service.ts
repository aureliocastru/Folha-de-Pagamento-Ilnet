import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ItemDeOs } from '@prisma/client';
import { AlmoxarifadosService } from '../almoxarifado/almoxarifados.service';
import { ehAlmoxForaDaCasa, numeroDoIxc } from '../almoxarifado/estoque.mapper';
import { EstoqueService } from '../almoxarifado/estoque.service';
import { situacaoDaPeca } from '../almoxarifado/mover-tudo';
import {
  hojeParaIxc,
  montarItemDaTransferencia,
  montarPatrimonioDaTransferencia,
  montarTransferencia,
} from '../almoxarifado/produtos-ixc';
import { ProdutosService } from '../almoxarifado/produtos.service';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import { OsDoIxcService } from './os-do-ixc.service';
import { naTela, type ItemNaTela } from './os.service';

/** Quantos aparelhos se recebem de uma vez — cada um é uma ida ao IXC. */
const POR_VEZ = 30;

/** Um aparelho que voltou de cliente e está com o técnico. */
export interface RecolhidoNaTela extends ItemNaTela {
  osIxcId: number;
  cliente: string | null;
  tecnicoId: string;
  /** Há quantos dias saiu do cliente. */
  dias: number;
}

/** O que o recebimento fez com cada aparelho. */
export interface ResultadoDoRecebimento {
  recebidos: number;
  destino: string | null;
  transferencias: number[];
  recusados: Array<{ itemId: string; descricao: string; motivo: string }>;
}

interface Quem {
  nome: string;
}

/**
 * O aparelho que voltou de cliente, da van até a base.
 *
 * A baixa do comodato devolve a peça ao almoxarifado do **técnico** — é com
 * ele que ela está, e é dele a responsabilidade até entregar. Aqui a base
 * confirma que recebeu: a peça vai, por transferência no IXC, para a triagem
 * ("Recolhidos (triagem)", criado no primeiro recebimento) ou para outro
 * almoxarifado que se escolha. Até isso, a tela do técnico recusa instalá-la
 * em outro cliente (ver `motivoParaNaoInstalar`).
 *
 * A divergência — o aparelho que o IXC não tinha no contrato — também passa
 * por aqui, mas sem transferência: não há o que mover no IXC. A base olha,
 * acerta o que for no IXC, e marca como recebido.
 */
@Injectable()
export class RecolhidosService {
  private readonly logger = new Logger(RecolhidosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly produtos: ProdutosService,
    private readonly almoxarifados: AlmoxarifadosService,
    private readonly estoque: EstoqueService,
    private readonly doIxc: OsDoIxcService,
  ) {}

  /** O que voltou de cliente e ainda não chegou à base, do mais antigo para o mais novo. */
  async pendentes(): Promise<RecolhidoNaTela[]> {
    const itens = await this.prisma.itemDeOs.findMany({
      where: {
        tipo: { in: ['RETIRADO', 'DIVERGENCIA'] },
        situacao: 'GRAVADO',
        recebidoEm: null,
      },
      include: {
        tecnico: { select: { nome: true, apelido: true } },
        registro: { select: { osIxcId: true, cliente: true } },
      },
      orderBy: { gravadoEm: 'asc' },
    });
    const agora = Date.now();
    return itens.map((i) => ({
      ...naTela(i),
      osIxcId: i.registro.osIxcId,
      cliente: i.registro.cliente,
      tecnicoId: i.tecnicoId,
      dias: Math.floor((agora - (i.gravadoEm ?? i.createdAt).getTime()) / 86_400_000),
    }));
  }

  /**
   * Recebe na base os aparelhos escolhidos.
   *
   * - `semTransferir`: só marca — para quando a peça já foi mexida no IXC por
   *   outro caminho, e para a divergência (que nunca tem o que transferir);
   * - senão, uma transferência por técnico, da van dele para o destino. Cada
   *   peça é relida antes: tem de estar na van, na prateleira. O que não está
   *   fica de fora, com o porquê, e continua pendente.
   */
  async receber(
    pedido: { itens: string[]; destinoAlmoxId?: number; semTransferir?: boolean },
    quem: Quem,
  ): Promise<ResultadoDoRecebimento> {
    const ids = [...new Set(pedido.itens)];
    if (ids.length === 0) throw new BadRequestException('Escolha o que chegou.');
    if (ids.length > POR_VEZ) {
      throw new BadRequestException(`Receba até ${POR_VEZ} aparelhos por vez.`);
    }
    const itens = await this.prisma.itemDeOs.findMany({ where: { id: { in: ids } } });
    const resultado: ResultadoDoRecebimento = {
      recebidos: 0,
      destino: null,
      transferencias: [],
      recusados: [],
    };
    const recusar = (i: ItemDeOs, motivo: string) =>
      resultado.recusados.push({ itemId: i.id, descricao: i.descricao, motivo });

    const receber: ItemDeOs[] = [];
    for (const i of itens) {
      if (i.recebidoEm) recusar(i, 'já foi recebido');
      else if (i.situacao !== 'GRAVADO') recusar(i, 'a retirada ainda não foi gravada no IXC');
      else if (i.tipo !== 'RETIRADO' && i.tipo !== 'DIVERGENCIA') recusar(i, 'não é aparelho retirado');
      else receber.push(i);
    }
    for (const id of ids) {
      if (!itens.some((i) => i.id === id)) {
        resultado.recusados.push({ itemId: id, descricao: '?', motivo: 'não encontrado' });
      }
    }

    // A divergência e o "sem transferir" só se marcam.
    const soMarcar = receber.filter((i) => pedido.semTransferir || i.tipo === 'DIVERGENCIA');
    const transferir = receber.filter((i) => !soMarcar.includes(i));
    for (const i of soMarcar) {
      await this.marcarRecebido(i.id, quem, null);
      resultado.recebidos += 1;
    }

    if (transferir.length > 0) {
      const destino = await this.destino(pedido.destinoAlmoxId, transferir[0].almoxId, quem);
      resultado.destino = destino.nome;
      const porVan = new Map<number, ItemDeOs[]>();
      for (const i of transferir) porVan.set(i.almoxId, [...(porVan.get(i.almoxId) ?? []), i]);

      for (const [almoxId, daVan] of porVan) {
        await this.transferirDaVan(almoxId, daVan, destino, quem, resultado, recusar);
      }
      this.estoque.esquecer();
    }

    this.logger.log(
      `${quem.nome} recebeu na base ${resultado.recebidos} aparelho(s) de OS` +
        (resultado.destino ? `, para "${resultado.destino}"` : '') +
        (resultado.recusados.length ? `; ${resultado.recusados.length} ficaram de fora` : '') +
        '.',
    );
    return resultado;
  }

  private async transferirDaVan(
    almoxId: number,
    itens: ItemDeOs[],
    destino: { id: number; nome: string; filialId: number },
    quem: Quem,
    resultado: ResultadoDoRecebimento,
    recusar: (i: ItemDeOs, motivo: string) => void,
  ): Promise<void> {
    const [[unidades, almoxarifados], cadastros, saldos] = await Promise.all([
      this.produtos.paraMovimentar(),
      this.produtos.cadastrosPorId(itens.map((i) => i.produtoId ?? 0)),
      this.doIxc.saldosNoAlmox(almoxId),
    ]);
    const origem = almoxarifados.find((a) => a.id === almoxId);
    if (!origem) {
      for (const i of itens) {
        recusar(i, `o almoxarifado do técnico (#${almoxId}) não está liberado para o sistema no IXC`);
      }
      return;
    }
    if (origem.id === destino.id) {
      for (const i of itens) recusar(i, 'o destino é o próprio almoxarifado do técnico');
      return;
    }

    // Cada peça relida: na van e na prateleira, ou fica de fora.
    const prontos: Array<{ item: ItemDeOs; corpo: (transferenciaId: number) => Record<string, unknown> }> = [];
    for (const i of itens) {
      const cadastro = cadastros.get(i.produtoId ?? 0);
      const unidade = unidades.find((u) => u.id === numeroDoIxc(cadastro?.unidade));
      if (!cadastro || !unidade) {
        recusar(i, 'o cadastro do produto (ou a unidade dele) não foi achado no IXC');
        continue;
      }
      if (i.patrimonioId) {
        const peca = await this.doIxc.patrimonio(i.patrimonioId).catch(() => null);
        const onde = numeroDoIxc(peca?.id_almoxarifado);
        const situacao = situacaoDaPeca(peca?.situacao);
        if (!peca || onde !== almoxId || !situacao.naPrateleira) {
          recusar(
            i,
            !peca
              ? 'a peça não foi achada no IXC'
              : `no IXC a peça está ${situacao.nome}` +
                  (onde !== almoxId ? ` no almoxarifado #${onde}` : '') +
                  ', e não na van. Se ela já está na base no IXC, receba "sem transferir"',
          );
          continue;
        }
        const patrimonioId = i.patrimonioId;
        const produtoId = i.produtoId ?? 0;
        prontos.push({
          item: i,
          corpo: (t) =>
            montarPatrimonioDaTransferencia(t, {
              patrimonioId,
              produtoId,
              unidadeId: unidade.id,
              unidadeSigla: unidade.sigla,
            }),
        });
      } else {
        const quantidade = Number(i.quantidade);
        const saldo = saldos.get(i.produtoId ?? 0) ?? 0;
        if (saldo < quantidade - 1e-9) {
          recusar(i, `a van tem ${saldo} desse produto no IXC, e não ${quantidade}`);
          continue;
        }
        const produtoId = i.produtoId ?? 0;
        prontos.push({
          item: i,
          corpo: (t) =>
            montarItemDaTransferencia(t, {
              produtoId,
              unidadeId: unidade.id,
              unidadeSigla: unidade.sigla,
              quantidade,
              tipoProduto: String(cadastro.tipo ?? ''),
            }),
        });
      }
    }
    if (prontos.length === 0) return;

    const { id: transferenciaId } = await this.ixc.create(
      'transf_almox_top',
      montarTransferencia({
        almoxSaida: origem.id,
        filialSaida: origem.filialId,
        almoxEntrada: destino.id,
        filialEntrada: destino.filialId,
        data: hojeParaIxc(),
        observacao: `Recolhidos de cliente, recebidos na base — pelo ILNET FINANCE, ${quem.nome}`,
      }),
    );
    if (!transferenciaId) {
      for (const p of prontos) recusar(p.item, 'o IXC não devolveu o número da transferência');
      return;
    }
    resultado.transferencias.push(transferenciaId);

    for (const p of prontos) {
      try {
        await this.ixc.create('transf_almox_item', p.corpo(transferenciaId));
        await this.marcarRecebido(p.item.id, quem, { ...destino, transferenciaId });
        resultado.recebidos += 1;
      } catch (err) {
        recusar(
          p.item,
          `o IXC recusou na transferência #${transferenciaId}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }

  /**
   * Para onde vão: o escolhido, ou a triagem. O escolhido tem de ser da casa —
   * nem Perdas nem Saídas, que não são prateleira.
   */
  private async destino(
    escolhido: number | undefined,
    almoxDoTecnico: number,
    quem: Quem,
  ): Promise<{ id: number; nome: string; filialId: number }> {
    const [, almoxarifados] = await this.produtos.paraMovimentar();
    if (escolhido) {
      const almox = almoxarifados.find((a) => a.id === escolhido);
      if (!almox) throw new BadRequestException('O sistema não enxerga esse almoxarifado no IXC.');
      if (!almox.ativo) throw new BadRequestException(`"${almox.nome}" está desativado no IXC.`);
      if (ehAlmoxForaDaCasa(almox.nome)) {
        throw new BadRequestException(`"${almox.nome}" não é prateleira — escolha outro destino.`);
      }
      return { id: almox.id, nome: almox.nome, filialId: almox.filialId };
    }
    const filialId = almoxarifados.find((a) => a.id === almoxDoTecnico)?.filialId || 1;
    const triagem = await this.almoxarifados.almoxDeRecolhidos(filialId, quem);
    const lido = (await this.produtos.paraMovimentar())[1].find((a) => a.id === triagem.id);
    return {
      id: triagem.id,
      nome: triagem.nome,
      filialId: lido?.filialId || filialId,
    };
  }

  private async marcarRecebido(
    itemId: string,
    quem: Quem,
    destino: { id: number; nome: string; transferenciaId: number } | null,
  ): Promise<void> {
    await this.prisma.itemDeOs.update({
      where: { id: itemId },
      data: {
        recebidoEm: new Date(),
        recebidoPor: quem.nome,
        destinoAlmoxId: destino?.id ?? null,
        destinoAlmox: destino?.nome ?? null,
        transferenciaIxcId: destino?.transferenciaId ?? null,
      },
    });
  }
}
