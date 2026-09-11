import { Injectable, Logger } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import {
  filtrarEstoque,
  montarEstoque,
  numeroDoIxc,
  resumirEstoque,
  type ItemDeEstoque,
  type LinhaDeEstoqueIxc,
  type LinhaDeMinimoIxc,
  type ResumoDoEstoque,
} from './estoque.mapper';

/**
 * Quanto tempo a leitura do IXC vale antes de ser refeita.
 *
 * Estoque não muda de segundo em segundo, e a tela é uma lista que se filtra
 * enquanto se digita — sem isto, cada letra viraria uma consulta ao IXC de
 * milhares de linhas. Um minuto é curto o bastante para quem acabou de dar
 * baixa lá ver o resultado ao recarregar, e longo o bastante para a tela não
 * pesar no webservice.
 */
const VALIDADE_MS = 60_000;

/** Teto de linhas lidas por consulta. Acima disso o IXC começa a demorar. */
const POR_PAGINA = 500;

interface Guardado {
  em: number;
  itens: ItemDeEstoque[];
}

export interface EstoqueNaTela {
  itens: ItemDeEstoque[];
  resumo: ResumoDoEstoque;
  /** Quando o IXC foi lido — a tela diz isso, porque o dado é de lá. */
  lidoEm: string;
  /** Os almoxarifados que apareceram, para a tela poder filtrar por um. */
  almoxarifados: Array<{ id: number; nome: string }>;
}

/**
 * O estoque de material, lido do IXC.
 *
 * **A fonte da verdade é o IXC.** O que se muda daqui (ver `ProdutosService`)
 * é escrito lá, pelos caminhos que o próprio IXC documenta, e não guardado
 * aqui: um segundo lugar com saldo próprio criaria dois saldos para a mesma
 * prateleira e nenhum jeito de saber qual está certo. Esta leitura é o
 * espelho, e é refeita depois de cada escrita.
 *
 * Uma consulta só resolve quase tudo: `estoque_produtos_almox_filial` devolve
 * produto, almoxarifado e saldo na mesma linha. O mínimo/máximo vem de outra, e
 * as unidades de uma terceira, ambas pequenas.
 */
@Injectable()
export class EstoqueService {
  private readonly logger = new Logger(EstoqueService.name);
  private guardado: Guardado | null = null;

  constructor(private readonly ixc: IxcClient) {}

  async listar(opcoes: {
    busca?: string;
    almoxId?: number;
    /** Só o que está abaixo do mínimo ou zerado. */
    soFaltando?: boolean;
    /** Ignora o que está guardado e vai ao IXC de novo. */
    recarregar?: boolean;
  }): Promise<EstoqueNaTela> {
    const todos = await this.doIxc(opcoes.recarregar === true);

    let itens = filtrarEstoque(todos, opcoes.busca ?? '');

    if (opcoes.almoxId) {
      /*
       * Filtrar por almoxarifado é recortar o item, e não só escolhê-lo: quem
       * pediu a van do Anderson quer o saldo da van, e mostrar o total da casa
       * ao lado do nome dela seria responder outra pergunta.
       */
      itens = itens
        .map((i) => {
          const saldos = i.saldos.filter((s) => s.almoxId === opcoes.almoxId);
          const total = saldos.reduce((s, x) => s + x.saldo, 0);
          return {
            ...i,
            saldos,
            total: Math.round(total * 1000) / 1000,
            abaixoDoMinimo: saldos.some((s) => s.abaixoDoMinimo),
            semNenhum: total <= 0,
          };
        })
        .filter((i) => i.saldos.length > 0);
    }

    if (opcoes.soFaltando) {
      itens = itens.filter((i) => i.abaixoDoMinimo || i.semNenhum);
    }

    return {
      itens,
      resumo: resumirEstoque(itens),
      lidoEm: new Date(this.guardado?.em ?? Date.now()).toISOString(),
      almoxarifados: almoxarifadosDe(todos),
    };
  }

  /**
   * Joga fora a leitura guardada. Depois de uma escrita no IXC a tela tem de
   * mostrar o que ficou lá, e não o que havia um minuto antes.
   */
  esquecer(): void {
    this.guardado = null;
  }

  /**
   * O saldo de um produto em cada almoxarifado, lido agora do IXC — sem a
   * leitura guardada. É a conferência depois de mexer: a tela diz o que o IXC
   * tem, e não o que este app acha que mandou.
   */
  async saldosDoProduto(produtoId: number): Promise<ItemDeEstoque | null> {
    const linhas = await this.ixc.listAll<LinhaDeEstoqueIxc>(
      'estoque_produtos_almox_filial',
      {
        qtype: 'estoque_produtos_almox_filial.id_produto',
        query: String(produtoId),
        oper: '=',
        sortname: 'estoque_produtos_almox_filial.id',
        sortorder: 'asc',
      },
      { pageSize: 200, maxPages: 5 },
    );
    const [item] = montarEstoque(linhas, [], await this.lerUnidades());
    return item ?? null;
  }

  /** A leitura do IXC, guardada por um minuto. */
  private async doIxc(recarregar: boolean): Promise<ItemDeEstoque[]> {
    const agora = Date.now();
    if (
      !recarregar &&
      this.guardado &&
      agora - this.guardado.em < VALIDADE_MS
    ) {
      return this.guardado.itens;
    }

    const [linhas, minimos, unidades] = await Promise.all([
      this.ixc.listAll<LinhaDeEstoqueIxc>(
        'estoque_produtos_almox_filial',
        {
          qtype: 'estoque_produtos_almox_filial.id',
          query: '0',
          oper: '>',
          sortname: 'estoque_produtos_almox_filial.id',
          sortorder: 'asc',
        },
        { pageSize: POR_PAGINA },
      ),
      /*
       * O mínimo/máximo é opcional: a casa pode não ter cadastrado nenhum, e
       * a tela funciona sem ele — só deixa de ter alerta. Falhar a leitura
       * dele não pode derrubar o estoque inteiro.
       */
      this.ixc
        .listAll<LinhaDeMinimoIxc>(
          'estoque_min_max_almox',
          {
            qtype: 'estoque_min_max.id',
            query: '0',
            oper: '>',
            sortname: 'estoque_min_max.id',
            sortorder: 'asc',
          },
          { pageSize: POR_PAGINA },
        )
        .catch((e: unknown) => {
          this.logger.warn(
            `Sem mínimo/máximo do IXC (${e instanceof Error ? e.message : e}); ` +
              'o estoque abre sem os alertas.',
          );
          return [] as LinhaDeMinimoIxc[];
        }),
      this.lerUnidades(),
    ]);

    const itens = montarEstoque(linhas, minimos, unidades);
    this.logger.log(
      `Estoque lido do IXC: ${linhas.length} linhas, ${itens.length} produtos.`,
    );
    this.guardado = { em: agora, itens };
    return itens;
  }

  /**
   * Os almoxarifados que aparecem no saldo — todo id que já teve produto
   * passando por ele. `AlmoxarifadosService` usa isto para completar o
   * cadastro: o `Almoxarifados (listar)` do IXC não devolve todos numa
   * chamada só (visto em produção — ele para na metade de quem tem saldo de
   * verdade), e um almoxarifado com material dentro não pode sumir da tela só
   * porque a listagem do cadastro o deixou de fora.
   */
  async almoxarifadosConhecidos(): Promise<Array<{ id: number; nome: string }>> {
    return almoxarifadosDe(await this.doIxc(false));
  }

  /** id da unidade → sigla ("UN", "M"). Some sem barulho se o IXC recusar. */
  private async lerUnidades(): Promise<Map<number, string>> {
    try {
      const linhas = await this.ixc.listAll<{
        id?: string;
        sigla?: string;
        descricao?: string;
      }>(
        'unidades',
        {
          qtype: 'unidades.id',
          query: '0',
          oper: '>',
          sortname: 'unidades.id',
          sortorder: 'asc',
        },
        { pageSize: 200, maxPages: 5 },
      );
      return new Map(
        linhas
          .map(
            (u) =>
              [numeroDoIxc(u.id), (u.sigla ?? u.descricao ?? '').trim()] as const,
          )
          .filter(([id, sigla]) => id > 0 && sigla !== ''),
      );
    } catch (e) {
      this.logger.warn(
        `Sem o cadastro de unidades do IXC (${e instanceof Error ? e.message : e}); ` +
          'os saldos aparecem sem a sigla.',
      );
      return new Map();
    }
  }
}

/** Os almoxarifados que aparecem no estoque, em ordem alfabética. */
function almoxarifadosDe(
  itens: ItemDeEstoque[],
): Array<{ id: number; nome: string }> {
  const achados = new Map<number, string>();
  for (const i of itens) {
    for (const s of i.saldos) achados.set(s.almoxId, s.almoxarifado);
  }
  return [...achados.entries()]
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
