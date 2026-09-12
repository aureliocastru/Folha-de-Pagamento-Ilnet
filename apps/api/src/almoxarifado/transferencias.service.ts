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
  pecasForaDaPrateleira,
  pecasPresas,
  patrimoniosMoviveis,
  produtoInativo,
  semSaldoParaAPeca,
  separarMoviveis,
  SITUACOES_LIDAS,
  type ItemDeFora,
  type ItemMovivel,
  type ItemSemPeca,
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
  /** Saldo de patrimônio sem peça cadastrada — vai pela quantidade, se pedirem. */
  semPeca: ItemSemPeca[];
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
  /**
   * Quantos o IXC recusou na primeira passada e estão sendo tentados de novo,
   * um por vez. Zero fora dessa hora.
   */
  tentandoDeNovo: number;
  movidos: LinhaDoResultado[];
  /**
   * O que o IXC recusou. `jaSaiu`: deu erro, mas relida a origem já não tem —
   * o IXC pode ter gravado; não se oferece de novo.
   */
  falharam: Array<LinhaDoResultado & { motivo: string; jaSaiu: boolean }>;
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
  /** No "mover tudo": leva também o saldo de patrimônio sem peça, pela quantidade. */
  levarSemPeca?: boolean;
}

type ItemDaTransferencia =
  | { tipo: 'produto'; item: ItemMovivel; quantidade: number }
  | { tipo: 'patrimonio'; peca: PatrimonioDoAlmoxarifado };

interface Quem {
  nome: string;
}

/** Quantos itens entram na transferência ao mesmo tempo. */
const ITENS_EM_PARALELO = 3;

/**
 * Quanto esperar antes de tentar de novo o que o IXC recusou.
 *
 * A recusa vista em produção (11/09/2026, "Ocorreu um erro ao processar.
 * Contate o suporte IXC Soft.") pegou exatamente os três itens que chegaram
 * juntos na transferência recém-aberta; os seis seguintes passaram. Por isso
 * o primeiro item vai sozinho, e o que for recusado ganha uma segunda chance,
 * um por vez.
 */
const PAUSA_ANTES_DE_REPETIR_MS = 2_000;

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
  /** O que cada transferência terminada não conseguiu levar — o "tentar de novo". */
  private readonly recusados = new Map<string, ItemDaTransferencia[]>();
  /** Almoxarifados numa transferência rodando — nem origem nem destino de outra. */
  private readonly ocupados = new Set<number>();
  /** Peças indisponíveis sem finalidade já descritas no log (ver `registrarPecaSemFinalidade`). */
  private readonly jaRegistradas = new Set<number>();
  /** Fica aqui, e não só na constante, para o teste não ter de esperar. */
  pausaAntesDeRepetirMs = PAUSA_ANTES_DE_REPETIR_MS;

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
    const inicio = Date.now();
    const [lido, [unidades], pecasDoIxc] = await Promise.all([
      this.estoque.listar({ almoxId, recarregar: true }),
      this.produtos.paraMovimentar(),
      this.pecasDoAlmoxarifado(almoxId),
    ]);
    /* Inativo fica de fora da janela inteira — ver `produtoInativo`. O que
       não diz se é ativo continua aparecendo: sumir com o que não se sabe
       seria pior do que mostrar. */
    const inativos = lido.itens.filter((i) => i.ativo === false);
    const itens = lido.itens
      .filter((i) => i.ativo !== false)
      .map((i) => ({
        produtoId: i.produtoId,
        descricao: i.descricao,
        saldo: i.total,
        unidade: i.unidade,
      }))
      .filter((i) => i.saldo > 0);
    const cadastros = await this.produtos.cadastrosPorId([
      ...itens.map((i) => i.produtoId),
      ...pecasDoIxc.map((l) => numeroDoIxc(l.id_produto)),
    ]);
    const linhasDePatrimonio = pecasDoIxc.filter(
      (l) => !produtoInativo(cadastros.get(numeroDoIxc(l.id_produto))),
    );
    const comSaldoParado = inativos.filter((i) => i.total !== 0).length;
    if (comSaldoParado > 0 || pecasDoIxc.length !== linhasDePatrimonio.length) {
      this.logger.log(
        `Almoxarifado #${almoxId}: ${comSaldoParado} produto(s) inativo(s) com saldo e ` +
          `${pecasDoIxc.length - linhasDePatrimonio.length} peça(s) de produto inativo fora da ` +
          'janela — inativo não se transfere, e o saldo deles está na tela Estoque.',
      );
    }

    this.registrarPecaSemFinalidade(linhasDePatrimonio);
    const saldoPorProduto = new Map(lido.itens.map((i) => [i.produtoId, i.total]));
    const lidas = patrimoniosMoviveis(linhasDePatrimonio, cadastros, unidades);
    const comSaldo = semSaldoParaAPeca(lidas.patrimonios, saldoPorProduto);
    /*
     * A peça sem saldo do produto aqui não aparece na tela — nem para mover,
     * nem entre as que ficam.
     *
     * Ela não está na prateleira: o saldo é 0, e ela é o que a entrada de
     * acerto criou para cobrir um negativo. Listá-la só enchia a janela de
     * linhas iguais e escondia o item que de fato pede decisão. Quem procura
     * uma peça que sumiu acha aqui no log.
     */
    const pecas = { patrimonios: comSaldo.patrimonios, deFora: lidas.deFora };
    if (comSaldo.deFora.length > 0) {
      this.logger.log(
        `${comSaldo.deFora.length} peça(s) do almoxarifado #${almoxId} fora da tela: o produto ` +
          'não tem saldo aqui, e mover a peça deixaria negativo.',
      );
    }
    const porPatrimonio = new Map<number, number>();
    for (const p of pecas.patrimonios) {
      porPatrimonio.set(p.produtoId, (porPatrimonio.get(p.produtoId) ?? 0) + 1);
    }
    const saldo = separarMoviveis(
      itens,
      cadastros,
      unidades,
      porPatrimonio,
      pecasForaDaPrateleira(linhasDePatrimonio),
      pecasPresas(linhasDePatrimonio),
    );
    const semPeca = await this.conferirSemPeca(almoxId, saldo.semPeca);
    this.logger.log(
      `Conteúdo do almoxarifado #${almoxId} lido em ${Date.now() - inicio} ms ` +
        `(${itens.length} produtos com saldo, ${linhasDePatrimonio.length} peças).`,
    );

    return {
      almoxId,
      nome: lido.almoxarifados.find((a) => a.id === almoxId)?.nome ?? `Almoxarifado ${almoxId}`,
      moviveis: saldo.moviveis,
      patrimonios: pecas.patrimonios,
      semPeca: semPeca.itens,
      deFora: [...saldo.deFora, ...pecas.deFora, ...semPeca.deFora],
    };
  }

  /**
   * O saldo de patrimônio sem peça só vai pelo que os movimentos confirmam.
   * Visto em produção (11/09/2026): a tabela de saldos dizia 1 notebook no
   * RABELO, os movimentos diziam 0 — mandado por quantidade, ele ficou -1.
   * Sem peça não há registro nenhum que confirme a quantidade, então se
   * confere pela soma dos movimentos, e vai o menor dos dois.
   */
  private async conferirSemPeca(
    almoxId: number,
    itens: ItemSemPeca[],
  ): Promise<{ itens: ItemSemPeca[]; deFora: ItemDeFora[] }> {
    const vao: ItemSemPeca[] = [];
    const deFora: ItemDeFora[] = [];
    await emParalelo(itens, 3, async (i) => {
      let confirmado: number;
      try {
        confirmado = await this.produtos.saldoPelosMovimentos(i.produtoId, almoxId);
      } catch {
        deFora.push({ ...i, motivo: 'não deu para conferir o saldo nos movimentos do IXC agora' });
        return;
      }
      const vai = Math.min(i.saldo, Math.round(confirmado * 1000) / 1000);
      if (!(vai > 0)) {
        deFora.push({
          ...i,
          motivo:
            `o IXC mostra saldo ${i.saldo}, mas os movimentos dele aqui somam ${confirmado} — ` +
            'não há o que levar (a leitura de saldo dele está desatualizada)',
        });
        return;
      }
      vao.push({ ...i, saldo: vai });
    });
    const porNome = (a: ItemSemPeca, b: ItemSemPeca) => a.descricao.localeCompare(b.descricao, 'pt-BR');
    return { itens: vao.sort(porNome), deFora };
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
      const levarSemPeca = !!pedido.tudo && !!pedido.levarSemPeca;
      const itens = pedido.tudo
        ? tudoDe(conteudo, levarSemPeca)
        : this.conferirPedido(pedido, conteudo);
      const ficam = [...conteudo.deFora, ...(levarSemPeca ? [] : conteudo.semPeca)];
      if (itens.length === 0) {
        throw new BadRequestException(
          pedido.tudo
            ? `"${origem.nome}" não tem nada para mover` +
                (ficam.length > 0
                  ? ` — só ${ficam.length} item(ns) que não vão por transferência.`
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
        tentandoDeNovo: 0,
        movidos: [],
        falharam: [],
        deFora: pedido.tudo ? ficam : [],
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
      void this.executar(andamento, itens, pedido.tudo ? { levarSemPeca } : null);
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
   * Abre uma transferência nova com o que a terminada não conseguiu levar —
   * o botão "Tentar de novo". A lista passa pela mesma conferência contra o
   * que a origem tem agora: o que já saiu de lá não vai duas vezes.
   */
  async repetir(id: string, quem: Quem): Promise<AndamentoDaTransferencia> {
    const a = this.andamento(id);
    if (a.status === 'rodando') {
      throw new BadRequestException('Essa transferência ainda está rodando. Espere ela terminar.');
    }
    const itens = this.recusados.get(id) ?? [];
    if (itens.length === 0) {
      throw new BadRequestException('Não sobrou nada dessa transferência para tentar de novo.');
    }
    return this.iniciar(
      {
        de: a.de.id,
        para: a.para.id,
        observacao: `de novo o que a #${a.transferenciaId} não levou`,
        produtos: itens.flatMap((i) =>
          i.tipo === 'produto' ? [{ produtoId: i.item.produtoId, quantidade: i.quantidade }] : [],
        ),
        patrimonios: itens.flatMap((i) => (i.tipo === 'patrimonio' ? [i.peca.patrimonioId] : [])),
      },
      quem,
    );
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
      // O saldo de patrimônio sem peça também vai pela quantidade, quando pedido.
      const item =
        conteudo.moviveis.find((m) => m.produtoId === p.produtoId) ??
        conteudo.semPeca.find((m) => m.produtoId === p.produtoId);
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

  /**
   * Grava os itens na transferência: o primeiro sozinho, o resto alguns por
   * vez, e o que o IXC recusar ganha uma segunda chance, um por vez (ver
   * `PAUSA_ANTES_DE_REPETIR_MS`).
   */
  private async executar(
    a: AndamentoDaTransferencia,
    itens: ItemDaTransferencia[],
    tudo: { levarSemPeca: boolean } | null,
  ): Promise<void> {
    try {
      const recusados: Array<{ item: ItemDaTransferencia; motivo: string }> = [];
      const incluir = async (i: ItemDaTransferencia) => {
        try {
          await this.gravarItem(a.transferenciaId, i);
          a.movidos.push(linhaDe(i));
        } catch (err) {
          const motivo = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Transferência #${a.transferenciaId}: o IXC recusou ${descreverParaLog(i)} (${motivo}).`,
          );
          recusados.push({ item: i, motivo });
        } finally {
          a.feitos += 1;
        }
      };

      const [primeiro, ...resto] = itens;
      await incluir(primeiro);
      await emParalelo(resto, ITENS_EM_PARALELO, incluir);

      const falharam = recusados.length > 0 ? await this.segundaChance(a, recusados) : [];
      a.falharam.push(
        ...falharam.map(({ item, motivo, jaSaiu }) => ({
          ...linhaDe(item),
          motivo,
          jaSaiu: !!jaSaiu,
        })),
      );
      this.recusados.set(
        a.id,
        falharam.filter((f) => !f.jaSaiu).map((f) => f.item),
      );

      this.estoque.esquecer();
      try {
        const depois = await this.conteudo(a.de.id);
        a.restouNaOrigem = tudo
          ? depois.moviveis.length +
            depois.patrimonios.length +
            (tudo.levarSemPeca ? depois.semPeca.length : 0)
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

  /**
   * As peças do almoxarifado que interessam a uma transferência — uma
   * consulta por situação (ver `SITUACOES_LIDAS`), juntas. Pedir todas as
   * peças do almoxarifado trazia o histórico inteiro de comodato: no
   * Principal, milhares de linhas, página por página, antes de a tela ter
   * resposta — e a de "Mover" desistia no minuto do nginx.
   */
  private async pecasDoAlmoxarifado(almoxId: number): Promise<Array<Record<string, unknown>>> {
    const porSituacao = await Promise.all(
      SITUACOES_LIDAS.map((situacao) =>
        this.ixc.listAll<Record<string, unknown>>(
          'patrimonio',
          {
            qtype: 'patrimonio.id_almoxarifado',
            query: String(almoxId),
            oper: '=',
            sortname: 'patrimonio.id',
            sortorder: 'asc',
            gridParam: [{ TB: 'patrimonio.situacao', OP: '=', P: situacao }],
          },
          { pageSize: 500, maxPages: 20 },
        ),
      ),
    );
    // Uma peça, uma linha — mesmo que o IXC a devolva em mais de uma consulta.
    const porId = new Map<number, Record<string, unknown>>();
    for (const l of porSituacao.flat()) porId.set(numeroDoIxc(l.id), l);
    return [...porId.values()];
  }

  /**
   * A tela do IXC diz onde a peça indisponível está presa ("Detalhes da
   * indisponibilidade"), mas a listagem da API veio sem isso em produção. Até
   * se saber onde o IXC põe essa informação na API, o log mostra as colunas
   * que vieram — uma vez por peça, e só as que falam de movimento.
   */
  private registrarPecaSemFinalidade(linhas: Array<Record<string, unknown>>): void {
    for (const l of linhas) {
      const id = numeroDoIxc(l.id);
      if (String(l.situacao ?? '').trim() !== '8' || l.finalidade_indisponivel) continue;
      if (this.jaRegistradas.has(id)) continue;
      this.jaRegistradas.add(id);
      const pistas = Object.entries(l)
        .filter(([k]) => /indispon|finalidade|moviment|entrada/i.test(k))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
      this.logger.warn(
        `Patrimônio #${id} indisponível sem finalidade na listagem. Colunas: ` +
          `${Object.keys(l).join(', ')}. Pistas: ${pistas.join(', ') || 'nenhuma'}.`,
      );
    }
  }

  private gravarItem(transferenciaId: number, i: ItemDaTransferencia) {
    return this.ixc.create(
      'transf_almox_item',
      i.tipo === 'produto'
        ? montarItemDaTransferencia(transferenciaId, {
            produtoId: i.item.produtoId,
            unidadeId: i.item.unidadeId,
            unidadeSigla: i.item.unidadeSigla,
            quantidade: i.quantidade,
            tipoProduto: i.item.tipoProduto,
          })
        : montarPatrimonioDaTransferencia(transferenciaId, i.peca),
    );
  }

  /**
   * A segunda chance do que o IXC recusou: relê a origem e, do que ainda
   * está lá, tenta de novo um por vez. O que já não está não é repetido —
   * o IXC pode ter gravado mesmo dizendo que deu erro, e mandar de novo
   * levaria duas vezes. Devolve o que continuou de fora.
   */
  private async segundaChance(
    a: AndamentoDaTransferencia,
    recusados: Array<{ item: ItemDaTransferencia; motivo: string }>,
  ): Promise<Array<{ item: ItemDaTransferencia; motivo: string; jaSaiu?: boolean }>> {
    a.tentandoDeNovo = recusados.length;
    try {
      await pausa(this.pausaAntesDeRepetirMs);
      this.estoque.esquecer();
      let agora: ConteudoDoAlmoxarifado;
      try {
        agora = await this.conteudo(a.de.id);
      } catch {
        return recusados; // sem saber o que a origem tem, não se arrisca repetir
      }

      const ficaram: Array<{ item: ItemDaTransferencia; motivo: string; jaSaiu?: boolean }> = [];
      for (const r of recusados) {
        if (!aindaNaOrigem(r.item, agora)) {
          ficaram.push({
            ...r,
            jaSaiu: true,
            motivo:
              `${r.motivo} — mas, relida agora, a origem já não tem: confira a ` +
              `transferência #${a.transferenciaId} no IXC antes de mandar de novo`,
          });
        } else {
          try {
            await this.gravarItem(a.transferenciaId, r.item);
            a.movidos.push(linhaDe(r.item));
            this.logger.log(
              `Transferência #${a.transferenciaId}: ${descreverParaLog(r.item)} entrou na segunda tentativa.`,
            );
          } catch (err) {
            ficaram.push({ ...r, motivo: err instanceof Error ? err.message : String(err) });
          }
        }
        a.tentandoDeNovo -= 1;
      }
      return ficaram;
    } finally {
      a.tentandoDeNovo = 0;
    }
  }

  private esquecerVelhas(): void {
    const limite = Date.now() - GUARDA_MS;
    for (const [id, a] of this.andamentos) {
      if (a.terminadoEm && Date.parse(a.terminadoEm) < limite) {
        this.andamentos.delete(id);
        this.recusados.delete(id);
      }
    }
  }

}

function tudoDe(c: ConteudoDoAlmoxarifado, levarSemPeca: boolean): ItemDaTransferencia[] {
  return [
    ...c.moviveis.map((item) => ({ tipo: 'produto' as const, item, quantidade: item.saldo })),
    ...c.patrimonios.map((peca) => ({ tipo: 'patrimonio' as const, peca })),
    ...(levarSemPeca
      ? c.semPeca.map((item) => ({ tipo: 'produto' as const, item, quantidade: item.saldo }))
      : []),
  ];
}

function pausa(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** "produto #36 (tipo C, 2 UND)" / "patrimônio #9 (produto #34)" — o que o log precisa. */
function descreverParaLog(i: ItemDaTransferencia): string {
  return i.tipo === 'produto'
    ? `produto #${i.item.produtoId} "${i.item.descricao}" (tipo ${i.item.tipoProduto || '?'}, ` +
        `${i.quantidade} ${i.item.unidadeSigla})`
    : `patrimônio #${i.peca.patrimonioId} (produto #${i.peca.produtoId})`;
}

/**
 * O item ainda está na origem como estava — produto com o saldo inteiro de
 * antes (não baixou nada), peça ainda na prateleira. Na dúvida, não: repetir
 * o que já foi levaria duas vezes.
 */
function aindaNaOrigem(i: ItemDaTransferencia, agora: ConteudoDoAlmoxarifado): boolean {
  if (i.tipo === 'patrimonio') {
    return agora.patrimonios.some((p) => p.patrimonioId === i.peca.patrimonioId);
  }
  const atual =
    agora.moviveis.find((m) => m.produtoId === i.item.produtoId) ??
    agora.semPeca.find((m) => m.produtoId === i.item.produtoId);
  return !!atual && atual.saldo >= i.quantidade - 1e-9 && atual.saldo > i.item.saldo - i.quantidade + 1e-6;
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
        ((
          depois.moviveis.find((m) => m.produtoId === i.item.produtoId) ??
          depois.semPeca.find((m) => m.produtoId === i.item.produtoId)
        )?.saldo ?? 0) >
        i.item.saldo - i.quantidade + 1e-6,
  ).length;
}
