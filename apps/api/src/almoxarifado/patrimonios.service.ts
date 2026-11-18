import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import { numeroDoIxc } from './estoque.mapper';
import { identidadeDaPeca, situacaoDaPeca } from './mover-tudo';

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

/** Uma peça numerada, como a aba Patrimônios a mostra. */
export interface PatrimonioNaTela {
  numero: number;
  patrimonioId: number;
  produtoId: number;
  produto: string;
  /** O número de série de fábrica (`serial_fornecedor`), lido agora do IXC. */
  numeroSerie: string | null;
  mac: string | null;
  almoxId: number | null;
  /** "disponível", "em comodato"… — null quando o IXC não respondeu pela peça. */
  situacao: string | null;
  codigoAnterior: string | null;
  entradaId: number | null;
  dadoPor: string;
  dadoEm: string;
}

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
export class PatrimoniosService {
  private readonly logger = new Logger(PatrimoniosService.name);
  /** Uma numeração por vez: duas notas ao mesmo tempo não disputam o mesmo número. */
  private fila: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
  ) {}

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

  /** As peças numeradas pelo sistema, da mais nova para a mais velha, com o que o IXC diz delas agora. */
  async listar(): Promise<PatrimonioNaTela[]> {
    const numeradas = await this.prisma.numeroDePatrimonio.findMany({ orderBy: { numero: 'desc' }, take: 2000 });
    const linhas = new Map<number, Record<string, unknown>>();
    // De 200 em 200: o IN do id vai inteiro no filtro.
    for (let i = 0; i < numeradas.length; i += 200) {
      const ids = numeradas.slice(i, i + 200).map((n) => n.idPatrimonioIxc);
      const r = await this.ixc
        .list<Record<string, unknown>>('patrimonio', {
          qtype: 'patrimonio.id',
          query: '0',
          oper: '>',
          rp: 200,
          sortname: 'patrimonio.id',
          gridParam: [{ TB: 'patrimonio.id', OP: 'IN', P: ids.join(',') }],
        })
        .catch((err: unknown) => {
          this.logger.warn(`Patrimônios: o IXC não respondeu pelas peças (${err instanceof Error ? err.message : String(err)}).`);
          return { registros: [] as Array<Record<string, unknown>> };
        });
      for (const l of r.registros) linhas.set(numeroDoIxc(l.id), l);
    }
    return numeradas.map((n) => {
      const l = linhas.get(n.idPatrimonioIxc);
      const peca = l ? identidadeDaPeca(l) : null;
      return {
        numero: n.numero,
        patrimonioId: n.idPatrimonioIxc,
        produtoId: n.idProdutoIxc,
        produto: n.produto,
        numeroSerie: peca?.numeroSerie ?? null,
        mac: peca?.mac ?? null,
        almoxId: l ? numeroDoIxc(l.id_almoxarifado) || null : null,
        situacao: l ? situacaoDaPeca(l.situacao).nome.replace(/ \(.*\)$/, '') : null,
        codigoAnterior: n.codigoAnterior,
        entradaId: n.idEntradaIxc,
        dadoPor: n.dadoPor,
        dadoEm: n.createdAt.toISOString(),
      };
    });
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

function textoOuNulo(v: unknown): string | null {
  const t = String(v ?? '').trim();
  return t ? t : null;
}
