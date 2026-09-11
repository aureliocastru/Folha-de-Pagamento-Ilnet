import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IxcClient } from '../ixc/ixc.client';
import { numeroDoIxc } from './estoque.mapper';
import { EstoqueService } from './estoque.service';
import {
  emParalelo,
  identificacao,
  patrimoniosMoviveis,
  separarMoviveis,
  type ItemDeFora,
  type ItemMovivel,
  type PatrimonioDoAlmoxarifado,
} from './mover-tudo';
import { ProdutosService } from './produtos.service';
import {
  hojeParaIxc,
  montarItemDaTransferencia,
  montarPatrimonioDaTransferencia,
  montarTransferencia,
} from './produtos-ixc';

/** O que um almoxarifado tem agora — o que pode ir numa transferência e o que não. */
export interface ConteudoDoAlmoxarifado {
  almoxId: number;
  nome: string;
  /** Produtos comuns, por quantidade. */
  moviveis: ItemMovivel[];
  /** Peças de patrimônio na prateleira (ONU, roteador…), cada uma com MAC e número. */
  patrimonios: PatrimonioDoAlmoxarifado[];
  deFora: ItemDeFora[];
}

/** Uma linha do resultado: o que foi (ou não foi), dito para gente ler. */
interface LinhaDoResultado {
  chave: string;
  descricao: string;
  /** "40 UND" ou "nº 00123 · MAC …". */
  detalhe: string;
}

/** Uma transferência de vários itens, rodando ou terminada. */
export interface AndamentoDaTransferencia {
  id: string;
  de: { id: number; nome: string };
  para: { id: number; nome: string };
  /** A transferência que o IXC abriu — todos os itens vão nela. */
  transferenciaId: number;
  status: 'rodando' | 'terminou' | 'falhou';
  total: number;
  feitos: number;
  movidos: LinhaDoResultado[];
  falharam: Array<LinhaDoResultado & { motivo: string }>;
  /** O que ficou de fora de propósito (só no "mover tudo"). */
  deFora: ItemDeFora[];
  /**
   * Itens que a origem ainda tem, relida no IXC no fim — no "mover tudo" é
   * tudo o que sobrou; na escolhida, só o que estava na lista. Null se a
   * releitura falhou.
   */
  restouNaOrigem: number | null;
  erro: string | null;
  iniciadoEm: string;
  terminadoEm: string | null;
}

/** O que a tela manda: produtos com quantidade e peças de patrimônio pelo id. */
export interface PedidoDeTransferencia {
  de: number;
  para: number;
  observacao?: string;
  produtos?: Array<{ produtoId: number; quantidade: number }>;
  patrimonios?: number[];
  /** Tudo o que dá para levar — o "mover tudo". */
  tudo?: boolean;
}

type ItemDaTransferencia =
  | { tipo: 'produto'; item: ItemMovivel; quantidade: number }
  | { tipo: 'patrimonio'; peca: PatrimonioDoAlmoxarifado };

interface Quem {
  nome: string;
}

/** Quantos itens entram na transferência ao mesmo tempo. */
const ITENS_EM_PARALELO = 3;

/** Quanto tempo uma transferência terminada fica guardada para a tela ler o resultado. */
const GUARDA_MS = 60 * 60_000;

/**
 * A transferência entre almoxarifados de **vários itens** — o que no IXC é
 * abrir a transferência e ir incluindo produto e patrimônio, aqui numa tela.
 *
 * Tudo vai numa `transf_almox_top` só, com um `transf_almox_item` por coisa:
 * produto comum pela quantidade, patrimônio pela peça (`id_patrimonio`). O
 * IXC move cada item ao gravá-lo ("após cadastrar, já é feito a
 * transferência"), então o registro fica todo lá — número da transferência,
 * quem fez, o que foi.
 *
 * Roda em segundo plano: centenas de itens passam do minuto que o nginx dá à
 * requisição. A chamada valida, abre a transferência e volta na hora; a tela
 * acompanha por `andamento`. Um item que o IXC recusa não para os outros.
 */
@Injectable()
export class TransferenciasService {
  private readonly logger = new Logger(TransferenciasService.name);
  private readonly andamentos = new Map<string, AndamentoDaTransferencia>();
  /** Almoxarifados numa transferência rodando — nem origem nem destino de outra. */
  private readonly ocupados = new Set<number>();

  constructor(
    private readonly ixc: IxcClient,
    private readonly estoque: EstoqueService,
    private readonly produtos: ProdutosService,
  ) {}

  /**
   * O que o almoxarifado tem agora — lido de novo do IXC, sem a leitura
   * guardada: é a lista que a tela mostra para escolher, e tem de ser a de
   * agora.
   */
  async conteudo(almoxId: number): Promise<ConteudoDoAlmoxarifado> {
    const [lido, [unidades], linhasDePatrimonio] = await Promise.all([
      this.estoque.listar({ almoxId, recarregar: true }),
      this.produtos.paraMovimentar(),
      this.ixc.listAll<Record<string, unknown>>(
        'patrimonio',
        {
          qtype: 'patrimonio.id_almoxarifado',
          query: String(almoxId),
          oper: '=',
          sortname: 'patrimonio.id',
          sortorder: 'asc',
        },
        { pageSize: 500, maxPages: 20 },
      ),
    ]);
    const itens = lido.itens
      .map((i) => ({
        produtoId: i.produtoId,
        descricao: i.descricao,
        saldo: i.total,
        unidade: i.unidade,
      }))
      .filter((i) => i.saldo > 0);
    const cadastros = await this.produtosPorId([
      ...itens.map((i) => i.produtoId),
      ...linhasDePatrimonio.map((l) => numeroDoIxc(l.id_produto)),
    ]);

    const pecas = patrimoniosMoviveis(linhasDePatrimonio, cadastros, unidades);
    const porPatrimonio = new Map<number, number>();
    for (const p of pecas.patrimonios) {
      porPatrimonio.set(p.produtoId, (porPatrimonio.get(p.produtoId) ?? 0) + 1);
    }
    const saldo = separarMoviveis(itens, cadastros, unidades, porPatrimonio);

    return {
      almoxId,
      nome: lido.almoxarifados.find((a) => a.id === almoxId)?.nome ?? `Almoxarifado ${almoxId}`,
      moviveis: saldo.moviveis,
      patrimonios: pecas.patrimonios,
      deFora: [...saldo.deFora, ...pecas.deFora],
    };
  }

  async iniciar(pedido: PedidoDeTransferencia, quem: Quem): Promise<AndamentoDaTransferencia> {
    const { de, para } = pedido;
    if (de === para) {
      throw new BadRequestException('A origem e o destino são o mesmo almoxarifado.');
    }
    if (this.ocupados.has(de) || this.ocupados.has(para)) {
      throw new BadRequestException(
        'Já tem uma transferência rodando com um desses almoxarifados. Espere ela terminar.',
      );
    }
    this.ocupados.add(de);
    this.ocupados.add(para);

    try {
      const [, almoxarifados] = await this.produtos.paraMovimentar();
      const origem = almoxarifados.find((a) => a.id === de);
      const destino = almoxarifados.find((a) => a.id === para);
      if (!origem || !destino) {
        throw new BadRequestException(
          `O sistema não enxerga o almoxarifado de ${!origem ? 'origem' : 'destino'} no IXC — ` +
            'é de técnico e não está liberado. Libere na aba Almoxarifados e tente de novo.',
        );
      }
      if (!destino.ativo) {
        throw new BadRequestException(`O almoxarifado "${destino.nome}" está desativado no IXC.`);
      }

      const conteudo = await this.conteudo(de);
      const itens = pedido.tudo ? tudoDe(conteudo) : this.conferirPedido(pedido, conteudo);
      if (itens.length === 0) {
        throw new BadRequestException(
          pedido.tudo
            ? `"${origem.nome}" não tem nada para mover` +
                (conteudo.deFora.length > 0
                  ? ` — só ${conteudo.deFora.length} item(ns) que não vão por transferência.`
                  : '.')
            : 'A lista está vazia — escolha o que vai.',
        );
      }

      const { id: transferenciaId } = await this.ixc.create(
        'transf_almox_top',
        montarTransferencia({
          almoxSaida: origem.id,
          filialSaida: origem.filialId,
          almoxEntrada: destino.id,
          filialEntrada: destino.filialId,
          data: hojeParaIxc(),
          observacao:
            (pedido.observacao?.trim() ? `${pedido.observacao.trim()} — ` : '') +
            (pedido.tudo ? `tudo de ${origem.nome} para ${destino.nome}, ` : '') +
            `pelo ILNET FINANCE, ${quem.nome}`,
        }),
      );
      if (!transferenciaId) {
        throw new BadRequestException(
          'O IXC não devolveu o número da transferência — nada foi movido. Tente de novo.',
        );
      }

      const andamento: AndamentoDaTransferencia = {
        id: randomUUID(),
        de: { id: origem.id, nome: origem.nome },
        para: { id: destino.id, nome: destino.nome },
        transferenciaId,
        status: 'rodando',
        total: itens.length,
        feitos: 0,
        movidos: [],
        falharam: [],
        deFora: pedido.tudo ? conteudo.deFora : [],
        restouNaOrigem: null,
        erro: null,
        iniciadoEm: new Date().toISOString(),
        terminadoEm: null,
      };
      this.esquecerVelhas();
      this.andamentos.set(andamento.id, andamento);
      this.logger.log(
        `${quem.nome} começou a transferir ${itens.length} item(ns) de ${origem.nome} para ` +
          `${destino.nome} (transferência #${transferenciaId} no IXC${pedido.tudo ? ', tudo' : ''}).`,
      );
      void this.executar(andamento, itens, !!pedido.tudo);
      return andamento;
    } catch (err) {
      this.ocupados.delete(de);
      this.ocupados.delete(para);
      throw err;
    }
  }

  andamento(id: string): AndamentoDaTransferencia {
    const a = this.andamentos.get(id);
    if (!a) {
      throw new NotFoundException(
        'Essa transferência não está mais aqui (o servidor pode ter reiniciado). O que foi ' +
          'movido está no IXC — confira a transferência lá.',
      );
    }
    return a;
  }

  /**
   * Confere a lista escolhida contra o que a origem tem **agora**: produto
   * que não está lá, quantidade maior que o saldo, peça que já saiu — recusa
   * tudo antes de abrir a transferência, dizendo o quê.
   */
  private conferirPedido(
    pedido: PedidoDeTransferencia,
    conteudo: ConteudoDoAlmoxarifado,
  ): ItemDaTransferencia[] {
    const itens: ItemDaTransferencia[] = [];
    const problemas: string[] = [];

    for (const p of pedido.produtos ?? []) {
      const item = conteudo.moviveis.find((m) => m.produtoId === p.produtoId);
      if (!item) {
        problemas.push(`o produto #${p.produtoId} não tem saldo que vá por quantidade aqui`);
      } else if (!(p.quantidade > 0)) {
        problemas.push(`"${item.descricao}" está com quantidade zero`);
      } else if (p.quantidade > item.saldo + 1e-9) {
        problemas.push(`"${item.descricao}" tem ${item.saldo}, não ${p.quantidade}`);
      } else {
        itens.push({ tipo: 'produto', item, quantidade: p.quantidade });
      }
    }
    for (const id of new Set(pedido.patrimonios ?? [])) {
      const peca = conteudo.patrimonios.find((p) => p.patrimonioId === id);
      if (!peca) {
        problemas.push(`o patrimônio #${id} não está disponível neste almoxarifado`);
      } else {
        itens.push({ tipo: 'patrimonio', peca });
      }
    }

    if (problemas.length > 0) {
      throw new BadRequestException(
        `A lista não bate com o que "${conteudo.nome}" tem agora no IXC: ` +
          `${problemas.join('; ')}. Atualize a tela e confira.`,
      );
    }
    return itens;
  }

  private async executar(
    a: AndamentoDaTransferencia,
    itens: ItemDaTransferencia[],
    tudo: boolean,
  ): Promise<void> {
    try {
      await emParalelo(itens, ITENS_EM_PARALELO, async (i) => {
        const linha = linhaDe(i);
        try {
          await this.ixc.create(
            'transf_almox_item',
            i.tipo === 'produto'
              ? montarItemDaTransferencia(a.transferenciaId, {
                  produtoId: i.item.produtoId,
                  unidadeId: i.item.unidadeId,
                  unidadeSigla: i.item.unidadeSigla,
                  quantidade: i.quantidade,
                  tipoProduto: i.item.tipoProduto,
                })
              : montarPatrimonioDaTransferencia(a.transferenciaId, i.peca),
          );
          a.movidos.push(linha);
        } catch (err) {
          a.falharam.push({ ...linha, motivo: err instanceof Error ? err.message : String(err) });
        } finally {
          a.feitos += 1;
        }
      });

      this.estoque.esquecer();
      try {
        const depois = await this.conteudo(a.de.id);
        a.restouNaOrigem = tudo
          ? depois.moviveis.length + depois.patrimonios.length
          : contarQueFicaram(itens, depois);
      } catch {
        a.restouNaOrigem = null;
      }
      a.status = 'terminou';
    } catch (err) {
      a.status = 'falhou';
      a.erro = err instanceof Error ? err.message : String(err);
    } finally {
      a.terminadoEm = new Date().toISOString();
      this.ocupados.delete(a.de.id);
      this.ocupados.delete(a.para.id);
      this.logger.log(
        `Transferência #${a.transferenciaId} (${a.de.nome} → ${a.para.nome}): ` +
          `${a.movidos.length} movidos, ${a.falharam.length} recusados pelo IXC, ` +
          `${a.restouNaOrigem ?? '?'} ainda na origem.`,
      );
    }
  }

  private esquecerVelhas(): void {
    const limite = Date.now() - GUARDA_MS;
    for (const [id, a] of this.andamentos) {
      if (a.terminadoEm && Date.parse(a.terminadoEm) < limite) this.andamentos.delete(id);
    }
  }

  /**
   * Os cadastros dos produtos pelos ids. Poucos, um a um; muitos, a tabela
   * inteira de uma vez — centenas de consultas custam mais que ela.
   */
  private async produtosPorId(ids: number[]): Promise<Map<number, Record<string, unknown>>> {
    const unicos = [...new Set(ids)].filter((id) => id > 0);
    const mapa = new Map<number, Record<string, unknown>>();
    if (unicos.length === 0) return mapa;
    if (unicos.length <= 40) {
      const achados = await Promise.all(
        unicos.map((id) =>
          this.ixc
            .getById<Record<string, unknown>>('produtos', 'produtos.id', id)
            .catch(() => null),
        ),
      );
      achados.forEach((p, i) => {
        if (p) mapa.set(unicos[i], p);
      });
      return mapa;
    }
    const procurados = new Set(unicos);
    const todos = await this.ixc.listAll<Record<string, unknown>>(
      'produtos',
      { qtype: 'produtos.id', query: '0', oper: '>', sortname: 'produtos.id', sortorder: 'asc' },
      { pageSize: 500 },
    );
    for (const p of todos) {
      const id = numeroDoIxc(p.id);
      if (procurados.has(id)) mapa.set(id, p);
    }
    return mapa;
  }
}

function tudoDe(c: ConteudoDoAlmoxarifado): ItemDaTransferencia[] {
  return [
    ...c.moviveis.map((item) => ({ tipo: 'produto' as const, item, quantidade: item.saldo })),
    ...c.patrimonios.map((peca) => ({ tipo: 'patrimonio' as const, peca })),
  ];
}

function linhaDe(i: ItemDaTransferencia): LinhaDoResultado {
  return i.tipo === 'produto'
    ? {
        chave: `produto-${i.item.produtoId}`,
        descricao: i.item.descricao,
        detalhe: `${i.quantidade} ${i.item.unidadeSigla}`,
      }
    : {
        chave: `patrimonio-${i.peca.patrimonioId}`,
        descricao: i.peca.descricao,
        detalhe: identificacao(i.peca),
      };
}

/** Das peças e produtos da lista, quantos a origem ainda tem depois de mover. */
function contarQueFicaram(itens: ItemDaTransferencia[], depois: ConteudoDoAlmoxarifado): number {
  return itens.filter((i) =>
    i.tipo === 'patrimonio'
      ? depois.patrimonios.some((p) => p.patrimonioId === i.peca.patrimonioId)
      : // Produto: só conta se sobrou mais do que havia antes menos o que foi.
        (depois.moviveis.find((m) => m.produtoId === i.item.produtoId)?.saldo ?? 0) >
        i.item.saldo - i.quantidade + 1e-6,
  ).length;
}
