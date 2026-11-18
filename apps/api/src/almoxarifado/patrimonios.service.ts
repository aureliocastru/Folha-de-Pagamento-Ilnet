import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import { numeroDoIxc } from './estoque.mapper';
import { identidadeDaPeca, normalizarCodigo, situacaoDaPeca } from './mover-tudo';
import { ProdutosService } from './produtos.service';

/**
 * O primeiro número que o sistema dá. Até 37870 a casa já marcou nos
 * equipamentos (pedido do Henrico, 18/11/2026).
 */
export const PRIMEIRO_NUMERO_DE_PATRIMONIO = 37871;

/** As colunas de `patrimonio` em que o tombo pode estar, na ordem em que se confia nelas. */
const COLUNAS_DO_TOMBO = ['serial', 'nro_patrimonio', 'cod_patrimonio'] as const;

interface Quem {
  nome: string;
}

/** Uma peça do IXC na consulta da aba: o que se procura e o que se mostra. */
export interface PecaDoCatalogo {
  patrimonioId: number;
  /** O tombo: o número da casa, ou as 5 letras que o IXC sorteou. */
  tombo: string | null;
  numerada: boolean;
  numeroSerie: string | null;
  mac: string | null;
  produtoId: number;
  produto: string;
  almoxarifado: string | null;
  situacao: string;
}

/** Uma página da consulta. */
export interface PaginaDoCatalogo {
  pecas: PecaDoCatalogo[];
  /** Quantas combinam com a busca (todas as páginas). */
  total: number;
  semSerie: number;
  proximo: number;
  /** Quando o IXC foi lido — a consulta guarda a leitura por alguns minutos. */
  lidoEm: string;
}

const CATALOGO_VALE_MS = 10 * 60_000;
const POR_PAGINA = 60;

/** O que aconteceu com cada peça que a nota criou. */
export interface PecaNumerada {
  patrimonioId: number;
  numero: number | null;
  erro?: string;
}

/**
 * O número de patrimônio — o tombo que o almoxarife marca no equipamento.
 *
 * O IXC cria a peça na entrada da compra com um código sorteado de 5 letras.
 * Aqui a peça recebe o próximo número da casa, gravado no próprio cadastro
 * dela no IXC (o "Nº Patrimônio" da tela de lá) e guardado nesta base, de onde
 * sai o número seguinte. E é aqui que se cadastra o número de série de fábrica.
 */
@Injectable()
export class PatrimoniosService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PatrimoniosService.name);
  /** Uma numeração por vez: duas notas ao mesmo tempo não disputam o mesmo número. */
  private fila: Promise<unknown> = Promise.resolve();
  /** Todas as peças do IXC, lidas de uma vez: são milhares, e a busca da aba roda em cima disto. */
  private catalogo: { em: number; pecas: PecaDoCatalogo[] } | null = null;
  private lendo: Promise<{ em: number; pecas: PecaDoCatalogo[] }> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly produtos: ProdutosService,
  ) {}

  /** A primeira abertura da aba não espera a leitura inteira do IXC. */
  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.lerCatalogo().catch(() => undefined), 60_000).unref?.();
  }

  /**
   * A consulta da aba: as peças do IXC, com busca por tombo, série, MAC ou
   * produto. Por padrão só as numeradas (o tombo é número); `todas` traz também
   * as que ainda estão com as 5 letras do IXC.
   */
  async consultar(filtro: {
    busca?: string;
    todas?: boolean;
    semSerie?: boolean;
    pagina?: number;
    reler?: boolean;
  }): Promise<PaginaDoCatalogo> {
    const [cat, proximo] = await Promise.all([this.lerCatalogo(filtro.reler), this.proximoNumero()]);
    const termos = semAcentoMaiusculo(filtro.busca ?? '').split(/\s+/).filter(Boolean);
    const base = cat.pecas.filter((p) => filtro.todas || p.numerada);
    const achadas = base.filter((p) => {
      if (filtro.semSerie && p.numeroSerie) return false;
      if (termos.length === 0) return true;
      const codigos = [p.tombo, p.numeroSerie, p.mac].map(normalizarCodigo);
      const nome = semAcentoMaiusculo(`${p.produto} ${p.almoxarifado ?? ''}`);
      return termos.every((t) => {
        const codigo = normalizarCodigo(t);
        return (codigo !== '' && codigos.some((c) => c.includes(codigo))) || nome.includes(t);
      });
    });
    const pagina = Math.max(1, Math.floor(filtro.pagina ?? 1));
    return {
      pecas: achadas.slice(0, pagina * POR_PAGINA),
      total: achadas.length,
      semSerie: base.filter((p) => !p.numeroSerie).length,
      proximo,
      lidoEm: new Date(cat.em).toISOString(),
    };
  }

  private lerCatalogo(reler = false): Promise<{ em: number; pecas: PecaDoCatalogo[] }> {
    if (!reler && this.catalogo && Date.now() - this.catalogo.em < CATALOGO_VALE_MS) {
      return Promise.resolve(this.catalogo);
    }
    if (this.lendo) return this.lendo;
    this.lendo = (async () => {
      const inicio = Date.now();
      const [linhas, [, almoxarifados]] = await Promise.all([
        this.ixc.listAll<Record<string, unknown>>(
          'patrimonio',
          { qtype: 'patrimonio.id', query: '0', oper: '>', sortname: 'patrimonio.id', sortorder: 'desc' },
          { pageSize: 1000, maxPages: 200 },
        ),
        this.produtos.paraMovimentar(),
      ]);
      const cadastros = await this.produtos.cadastrosPorId(linhas.map((l) => numeroDoIxc(l.id_produto)));
      const nomesDosAlmox = new Map(almoxarifados.map((a) => [a.id, a.nome]));
      const pecas = linhas
        .map((l) => pecaDoCatalogo(l, cadastros, nomesDosAlmox))
        .sort(
          (a, b) =>
            Number(b.numerada) - Number(a.numerada) ||
            (a.numerada ? Number(b.tombo) - Number(a.tombo) : b.patrimonioId - a.patrimonioId),
        );
      this.logger.log(
        `Patrimônios: ${pecas.length} peças lidas do IXC em ${Math.round((Date.now() - inicio) / 1000)} s.`,
      );
      this.catalogo = { em: Date.now(), pecas };
      return this.catalogo;
    })().finally(() => {
      this.lendo = null;
    });
    return this.lendo;
  }

  /** A peça mudou aqui: a consulta guardada passa a dizer o mesmo, sem reler o IXC inteiro. */
  private atualizarNoCatalogo(patrimonioId: number, mudanca: Partial<PecaDoCatalogo>): void {
    const p = this.catalogo?.pecas.find((x) => x.patrimonioId === patrimonioId);
    if (p) Object.assign(p, mudanca);
  }

  /** O maior `patrimonio.id` do IXC agora — as peças que a nota criar vêm depois dele. */
  async ultimaPeca(): Promise<number> {
    const r = await this.ixc.list<Record<string, unknown>>('patrimonio', {
      qtype: 'patrimonio.id',
      query: '0',
      oper: '>',
      rp: 1,
      sortname: 'patrimonio.id',
      sortorder: 'desc',
    });
    return numeroDoIxc(r.registros[0]?.id);
  }

  /** As peças do produto, naquele almoxarifado, criadas depois de `desdeId`. */
  async pecasCriadas(desdeId: number, produtoId: number, almoxId: number): Promise<Array<Record<string, unknown>>> {
    const linhas = await this.ixc.listAll<Record<string, unknown>>(
      'patrimonio',
      {
        qtype: 'patrimonio.id',
        query: String(desdeId),
        oper: '>',
        sortname: 'patrimonio.id',
        sortorder: 'asc',
        gridParam: [{ TB: 'patrimonio.id_produto', OP: '=', P: String(produtoId) }],
      },
      { pageSize: 200, maxPages: 5 },
    );
    // O filtro conferido de novo: peça de outro produto ou de outro lugar não leva número desta nota.
    return linhas.filter(
      (l) =>
        numeroDoIxc(l.id) > desdeId &&
        numeroDoIxc(l.id_produto) === produtoId &&
        numeroDoIxc(l.id_almoxarifado) === almoxId,
    );
  }

  /** O número que a próxima peça vai receber. */
  async proximoNumero(): Promise<number> {
    const r = await this.prisma.numeroDePatrimonio.aggregate({ _max: { numero: true } });
    return Math.max(PRIMEIRO_NUMERO_DE_PATRIMONIO, (r._max.numero ?? 0) + 1);
  }

  /** Dá a cada peça, na ordem, o próximo número. Peça que já tem número fica com o dela. */
  numerar(
    linhas: Array<Record<string, unknown>>,
    origem: { produto: string; entradaId?: number | null },
    quem: Quem,
  ): Promise<PecaNumerada[]> {
    const vez = this.fila.then(async () => {
      const feitas: PecaNumerada[] = [];
      for (const l of linhas) feitas.push(await this.numerarUma(l, origem, quem));
      return feitas;
    });
    this.fila = vez.catch(() => undefined);
    return vez;
  }

  /** Dá número a uma peça achada na aba (a que veio de compra feita no IXC). */
  async darNumero(patrimonioId: number, quem: Quem): Promise<PecaNumerada> {
    const linha = await this.lerPeca(patrimonioId);
    const atual = textoOuNulo(linha[colunaDoTombo(linha)]);
    if (atual && /^\d+$/.test(atual)) {
      throw new BadRequestException(`Esta peça já é o patrimônio ${atual}.`);
    }
    const produto = await this.nomeDoProduto(numeroDoIxc(linha.id_produto));
    const [feita] = await this.numerar([linha], { produto }, quem);
    if (feita.erro) throw new BadRequestException(feita.erro);
    return feita;
  }

  /** Grava o número de série de fábrica da peça no IXC, e relê para conferir. */
  async gravarSerie(patrimonioId: number, serie: string, quem: Quem): Promise<{ numeroSerie: string | null }> {
    const valor = serie.trim().replace(/\s+/g, ' ');
    if (valor.length > 60) throw new BadRequestException('O número de série passa de 60 caracteres.');
    const linha = await this.lerPeca(patrimonioId);
    if (valor) {
      const repetida = await this.ixc
        .list<Record<string, unknown>>('patrimonio', { qtype: 'patrimonio.serial_fornecedor', query: valor, oper: '=', rp: 5 })
        .then((r) => r.registros.find((l) => numeroDoIxc(l.id) !== patrimonioId))
        .catch(() => undefined);
      if (repetida) {
        const outra = identidadeDaPeca(repetida);
        throw new BadRequestException(
          `O número de série ${valor} já está na peça ${outra.numeroPatrimonial ?? `#${outra.patrimonioId}`}. Confira o equipamento.`,
        );
      }
    }
    await this.regravar(linha, { serial_fornecedor: valor });
    const relida = identidadeDaPeca(await this.lerPeca(patrimonioId));
    if ((relida.numeroSerie ?? '') !== valor) {
      throw new BadRequestException(
        `O IXC respondeu, mas a peça continua com a série "${relida.numeroSerie ?? ''}". Nada mudou.`,
      );
    }
    this.atualizarNoCatalogo(patrimonioId, { numeroSerie: relida.numeroSerie });
    this.logger.log(`${quem.nome} gravou a série "${valor}" na peça #${patrimonioId}.`);
    return { numeroSerie: relida.numeroSerie };
  }

  // -------------------------------------------------------------------------

  private async numerarUma(
    l: Record<string, unknown>,
    origem: { produto: string; entradaId?: number | null },
    quem: Quem,
  ): Promise<PecaNumerada> {
    const patrimonioId = numeroDoIxc(l.id);
    const ja = await this.prisma.numeroDePatrimonio.findUnique({ where: { idPatrimonioIxc: patrimonioId } });
    if (ja) return { patrimonioId, numero: ja.numero };

    const coluna = colunaDoTombo(l);
    const anterior = textoOuNulo(l[coluna]);
    const numero = await this.proximoNumero();
    // Reservado antes de ir ao IXC: o número é a chave, não sai duas vezes.
    try {
      await this.prisma.numeroDePatrimonio.create({
        data: {
          numero,
          idPatrimonioIxc: patrimonioId,
          idProdutoIxc: numeroDoIxc(l.id_produto),
          produto: origem.produto,
          codigoAnterior: anterior,
          idEntradaIxc: origem.entradaId ?? null,
          dadoPor: quem.nome,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { patrimonioId, numero: null, erro: 'o número foi tomado ao mesmo tempo — tente de novo' };
      }
      throw err;
    }

    let erro: string | null = null;
    try {
      await this.regravar(l, { [coluna]: String(numero) });
      const relida = await this.lerPeca(patrimonioId);
      if (String(relida[coluna] ?? '').trim() !== String(numero)) {
        erro = `o IXC respondeu, mas a peça continua com o código "${String(relida[coluna] ?? '')}"`;
      }
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }
    if (erro) {
      await this.prisma.numeroDePatrimonio.delete({ where: { numero } }).catch(() => undefined);
      this.logger.warn(`Peça #${patrimonioId} (${origem.produto}): o número ${numero} não colou no IXC (${erro}).`);
      return { patrimonioId, numero: null, erro };
    }
    this.atualizarNoCatalogo(patrimonioId, { tombo: String(numero), numerada: true });
    this.logger.log(
      `${quem.nome}: peça #${patrimonioId} (${origem.produto}) recebeu o número ${numero}` +
        `${anterior ? ` (era ${anterior})` : ''}, coluna ${coluna}.`,
    );
    return { patrimonioId, numero };
  }

  /** `PUT /patrimonio/:id` com a linha inteira — o webservice reescreve o registro, não o remenda. */
  private async regravar(linha: Record<string, unknown>, mudanca: Record<string, string>): Promise<void> {
    const id = numeroDoIxc(linha.id);
    const corpo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(linha)) corpo[k] = v === null || v === undefined ? '' : v;
    Object.assign(corpo, mudanca);
    await this.ixc.update('patrimonio', id, corpo);
  }

  private async lerPeca(patrimonioId: number): Promise<Record<string, unknown>> {
    const l = await this.ixc.getById<Record<string, unknown>>('patrimonio', 'patrimonio.id', patrimonioId);
    if (!l) throw new NotFoundException(`A peça #${patrimonioId} não existe no IXC.`);
    return l;
  }

  private async nomeDoProduto(produtoId: number): Promise<string> {
    const p = await this.ixc
      .getById<Record<string, unknown>>('produtos', 'produtos.id', produtoId)
      .catch(() => null);
    return textoOuNulo(p?.descricao) ?? `Produto ${produtoId}`;
  }
}

/** A coluna do tombo nesta linha: a primeira que existe e está preenchida (o IXC sempre sorteia um). */
export function colunaDoTombo(l: Record<string, unknown>): string {
  return (
    COLUNAS_DO_TOMBO.find((c) => textoOuNulo(l[c]) !== null) ??
    COLUNAS_DO_TOMBO.find((c) => c in l) ??
    'serial'
  );
}

function pecaDoCatalogo(
  l: Record<string, unknown>,
  cadastros: Map<number, Record<string, unknown>>,
  almox: Map<number, string>,
): PecaDoCatalogo {
  const peca = identidadeDaPeca(l);
  const produtoId = numeroDoIxc(l.id_produto);
  const almoxId = numeroDoIxc(l.id_almoxarifado);
  return {
    patrimonioId: peca.patrimonioId,
    tombo: peca.numeroPatrimonial,
    numerada: !!peca.numeroPatrimonial && /^\d+$/.test(peca.numeroPatrimonial),
    numeroSerie: peca.numeroSerie,
    mac: peca.mac,
    produtoId,
    produto:
      textoOuNulo(cadastros.get(produtoId)?.descricao) ?? textoOuNulo(l.descricao) ?? `Produto ${produtoId}`,
    almoxarifado: almoxId ? (almox.get(almoxId) ?? `Almoxarifado ${almoxId}`) : null,
    situacao: situacaoDaPeca(l.situacao).nome.replace(/ \(.*\)$/, ''),
  };
}

function semAcentoMaiusculo(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().trim();
}

function textoOuNulo(v: unknown): string | null {
  const t = String(v ?? '').trim();
  return t ? t : null;
}
