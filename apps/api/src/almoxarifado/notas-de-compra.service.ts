import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type NotaDeCompra } from '@prisma/client';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { IxcClient } from '../ixc/ixc.client';
import { lerSituacaoContaPagar } from '../ixc/ixc.financeiro';
import { PrismaService } from '../prisma/prisma.service';
import { numeroDaNotaParaIxc, ProdutosService, type CompraLancada } from './produtos.service';

interface Quem {
  nome: string;
}

/** Uma parcela guardada na nota. `idFnApagar` chega quando ela vira título. */
export interface ParcelaDaNota {
  /** "AAAA-MM-DD" */
  vencimento: string;
  valor: number;
  idFnApagar?: number | null;
}

/** A nota como as telas a leem. */
export interface NotaNaTela {
  id: string;
  numeroNota: string;
  fornecedor: { id: number; nome: string };
  dataEmissao: string;
  almoxarifado: string;
  valorTotal: number;
  entradaId: number;
  compraAberta: string | null;
  itens: CompraLancada['itens'];
  parcelas: ParcelaDaNota[];
  situacao: 'AGUARDANDO' | 'CONFIRMADA' | 'RECUSADA' | 'SEM_CONTA';
  lancadaPor: string;
  lancadaEm: string;
  decididaPor: string | null;
  motivoDaRecusa: string | null;
}

/**
 * A nota fiscal de compra do almoxarifado.
 *
 * Duas mãos, de propósito. O almoxarife lança a nota quando o material chega:
 * os produtos entram no estoque do IXC na hora (uma compra de Entradas ›
 * Compras, por `ProdutosService.lancarCompra`), e as parcelas que ele informou
 * ficam guardadas aqui. Quem cuida do Contas a Pagar vê a nota esperando e
 * decide: confirmando, cada parcela vira uma conta a pagar no IXC, pelo mesmo
 * caminho da despesa lançada à mão; recusando, nenhuma conta nasce — e o
 * estoque, que já entrou, não é tocado.
 */
@Injectable()
export class NotasDeCompraService {
  private readonly logger = new Logger(NotasDeCompraService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly produtos: ProdutosService,
    private readonly contasPagar: ContasPagarService,
    private readonly ixc: IxcClient,
  ) {}

  async lancar(
    dados: {
      fornecedorId: number;
      fornecedorNome: string;
      numeroNota: string;
      dataEmissao: string;
      almoxId: number;
      itens: Array<{ produtoId: number; quantidade: number; valorUnitario: number }>;
      parcelas?: Array<{ vencimento: string; valor: number }>;
    },
    quem: Quem,
  ): Promise<NotaNaTela> {
    // Só os algarismos, como vai ao IXC: "166.192.941" e "166192941" são a mesma nota.
    const numeroNota = numeroDaNotaParaIxc(dados.numeroNota);
    const total = totalDosItens(dados.itens);
    const parcelas = (dados.parcelas ?? []).map((p) => ({
      vencimento: p.vencimento.slice(0, 10),
      valor: centavos(p.valor),
    }));
    conferirParcelas(parcelas, total);

    // A mesma nota do mesmo fornecedor duas vezes dobraria o estoque.
    const repetida = await this.prisma.notaDeCompra.findFirst({
      where: { idFornecedorIxc: dados.fornecedorId, numeroNota },
    });
    if (repetida) {
      throw new BadRequestException(
        `A nota ${numeroNota} de ${repetida.fornecedorNome} já foi lançada por ` +
          `${repetida.lancadaPor} (compra #${repetida.idEntradaIxc} no IXC). Nada foi lançado de novo.`,
      );
    }

    const compra = await this.produtos.lancarCompra(
      {
        fornecedorId: dados.fornecedorId,
        numeroNota,
        dataEmissao: dados.dataEmissao,
        almoxId: dados.almoxId,
        itens: dados.itens,
      },
      quem,
    );

    const nota = await this.prisma.notaDeCompra.create({
      data: {
        numeroNota,
        idFornecedorIxc: dados.fornecedorId,
        fornecedorNome: dados.fornecedorNome.trim(),
        dataEmissao: new Date(`${dados.dataEmissao.slice(0, 10)}T00:00:00.000Z`),
        almoxId: dados.almoxId,
        almoxarifado: compra.almoxarifado,
        valorTotal: new Prisma.Decimal(total),
        idEntradaIxc: compra.entradaId,
        compraAberta: compra.compraAberta,
        itens: compra.itens as unknown as Prisma.InputJsonValue,
        parcelas: parcelas as unknown as Prisma.InputJsonValue,
        situacao: parcelas.length > 0 ? 'AGUARDANDO' : 'SEM_CONTA',
        lancadaPor: quem.nome,
      },
    });
    return naTela(nota);
  }

  /** As notas lançadas, da mais nova para a mais velha. */
  async listar(): Promise<NotaNaTela[]> {
    const notas = await this.prisma.notaDeCompra.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return notas.map(naTela);
  }

  /** As que esperam a decisão do Contas a Pagar, da mais velha para a mais nova. */
  async pendentes(): Promise<NotaNaTela[]> {
    const notas = await this.prisma.notaDeCompra.findMany({
      where: { situacao: 'AGUARDANDO' },
      orderBy: { createdAt: 'asc' },
    });
    return notas.map(naTela);
  }

  /**
   * Cada parcela vira uma conta a pagar. A que já virou não vira de novo: o
   * número do título é gravado parcela a parcela, e uma confirmação que parou
   * no meio (o IXC caiu na terceira) continua de onde parou.
   */
  async confirmar(
    id: string,
    opcoes: { categoriaId?: string },
    quem: Quem & { id?: string },
  ): Promise<NotaNaTela> {
    const nota = await this.umaAguardando(id);
    const parcelas = lerParcelas(nota.parcelas);
    const itens = nota.itens as unknown as CompraLancada['itens'];
    const resumo = resumoDosItens(itens);

    for (const [n, parcela] of parcelas.entries()) {
      if (parcela.idFnApagar) continue;
      const qual = parcelas.length > 1 ? ` · parcela ${n + 1}/${parcelas.length}` : '';
      let conta;
      try {
        conta = await this.contasPagar.criarDespesa(
          {
            idFornecedorIxc: nota.idFornecedorIxc,
            fornecedorNome: nota.fornecedorNome,
            valor: parcela.valor,
            dataEmissao: nota.dataEmissao,
            dataVencimento: new Date(`${parcela.vencimento}T00:00:00.000Z`),
            observacao: `NF ${nota.numeroNota}${qual} · ${resumo}`.slice(0, 250),
            documento: nota.numeroNota,
            numeroNota: nota.numeroNota,
          },
          quem.id,
        );
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        throw new BadRequestException(
          `A parcela ${n + 1} não virou conta (${motivo}). ` +
            (n > 0 ? `As ${n} anteriores já foram criadas; ` : '') +
            'confirme de novo para continuar de onde parou.',
        );
      }
      parcela.idFnApagar = conta.idFnApagarIxc ?? null;
      await this.prisma.notaDeCompra.update({
        where: { id },
        data: { parcelas: parcelas as unknown as Prisma.InputJsonValue },
      });
      if (opcoes.categoriaId && conta.idFnApagarIxc) {
        await this.prisma.classificacaoConta
          .upsert({
            where: { idFnApagar: conta.idFnApagarIxc },
            create: {
              idFnApagar: conta.idFnApagarIxc,
              categoriaId: opcoes.categoriaId,
              classificadoPor: quem.nome,
            },
            update: {},
          })
          .catch((err: unknown) =>
            this.logger.warn(
              `Título ${conta.idFnApagarIxc}: a categoria não colou ` +
                `(${err instanceof Error ? err.message : String(err)}).`,
            ),
          );
      }
    }

    const confirmada = await this.prisma.notaDeCompra.update({
      where: { id },
      data: { situacao: 'CONFIRMADA', decididaPor: quem.nome, decididaEm: new Date() },
    });
    this.logger.log(
      `${quem.nome} confirmou a nota ${nota.numeroNota} de ${nota.fornecedorNome}: ` +
        `${parcelas.length} conta(s) a pagar.`,
    );
    return naTela(confirmada);
  }

  /** Nenhuma conta nasce desta nota. O estoque, que já entrou, fica como está. */
  async recusar(id: string, motivo: string | undefined, quem: Quem): Promise<NotaNaTela> {
    const nota = await this.umaAguardando(id);
    if (lerParcelas(nota.parcelas).some((p) => p.idFnApagar)) {
      throw new BadRequestException(
        'Parte das parcelas desta nota já virou conta a pagar. Confirme para criar as ' +
          'que faltam, e apague no Contas a Pagar as que não forem devidas.',
      );
    }
    const recusada = await this.prisma.notaDeCompra.update({
      where: { id },
      data: {
        situacao: 'RECUSADA',
        decididaPor: quem.nome,
        decididaEm: new Date(),
        motivoDaRecusa: motivo?.trim() || null,
      },
    });
    this.logger.log(`${quem.nome} recusou as contas da nota ${nota.numeroNota}.`);
    return naTela(recusada);
  }

  /**
   * Desfaz a nota inteira, no IXC: apaga as contas a pagar que ela gerou,
   * tira os produtos do estoque e apaga a compra — e só então a nota some
   * daqui.
   *
   * A ordem protege o dinheiro: antes de tocar em qualquer coisa, cada título
   * é lido no IXC, e um só que já tenha sido pago (inteiro ou em parte) para
   * tudo — pagamento não se desfaz apagando. Depois vão as contas, e por último
   * o estoque. Se o IXC recusar no meio, a nota fica, com o que ainda resta
   * dela, e o Desfazer pode ser repetido: ele continua de onde parou.
   */
  async desfazer(id: string, quem: Quem): Promise<{ desfeita: true }> {
    const nota = await this.prisma.notaDeCompra.findUnique({ where: { id } });
    if (!nota) throw new NotFoundException('Nota não encontrada.');
    const parcelas = lerParcelas(nota.parcelas);

    for (const p of parcelas) {
      if (!p.idFnApagar) continue;
      const titulo = await this.ixc
        .getById<Record<string, unknown>>('fn_apagar', 'fn_apagar.id', p.idFnApagar)
        .catch((err: unknown) => {
          throw new BadRequestException(
            `Não deu para ler o título ${p.idFnApagar} no IXC (${motivoDe(err)}). Nada foi desfeito.`,
          );
        });
      if (!titulo) continue;
      const situacao = lerSituacaoContaPagar(titulo);
      if (situacao.pago || situacao.valorPago > 0) {
        throw new BadRequestException(
          `A conta de ${dinheiro(p.valor)} desta nota (título ${p.idFnApagar}) já foi paga. ` +
            'Nada foi desfeito — estorne o pagamento no IXC antes.',
        );
      }
    }

    for (const p of parcelas) {
      if (!p.idFnApagar) continue;
      const conta = await this.prisma.contaPagar.findFirst({
        where: { idFnApagarIxc: p.idFnApagar },
        select: { id: true },
      });
      try {
        if (conta) await this.contasPagar.remover(conta.id);
        else await this.ixc.remove('fn_apagar', p.idFnApagar);
      } catch (err) {
        throw new BadRequestException(
          `O IXC não apagou a conta de ${dinheiro(p.valor)} (título ${p.idFnApagar}): ` +
            `${motivoDe(err)}. O estoque não foi mexido.`,
        );
      }
      p.idFnApagar = null;
      await this.prisma.notaDeCompra.update({
        where: { id },
        data: {
          parcelas: parcelas as unknown as Prisma.InputJsonValue,
          // Sem as contas, a nota volta a ser uma nota esperando decisão.
          situacao: nota.situacao === 'CONFIRMADA' ? 'AGUARDANDO' : nota.situacao,
        },
      });
    }

    const compra = await this.produtos.desfazerCompra(
      nota.idEntradaIxc,
      { numeroNota: nota.numeroNota, fornecedorId: nota.idFornecedorIxc },
      quem,
    );
    if (!compra.ok) {
      throw new BadRequestException(
        `As contas a pagar da nota saíram, mas a compra não foi desfeita: ${compra.erro}. ` +
          'Tente o Desfazer de novo, ou apague a compra no IXC (Entradas › Compras).',
      );
    }

    await this.prisma.notaDeCompra.delete({ where: { id } });
    this.logger.log(`${quem.nome} desfez a nota ${nota.numeroNota} de ${nota.fornecedorNome}.`);
    return { desfeita: true };
  }

  private async umaAguardando(id: string): Promise<NotaDeCompra> {
    const nota = await this.prisma.notaDeCompra.findUnique({ where: { id } });
    if (!nota) throw new NotFoundException('Nota não encontrada.');
    if (nota.situacao !== 'AGUARDANDO') {
      throw new BadRequestException(
        `Esta nota já foi decidida${nota.decididaPor ? ` por ${nota.decididaPor}` : ''}.`,
      );
    }
    return nota;
  }
}

function motivoDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function centavos(v: number): number {
  return Math.round(Number(v) * 100) / 100;
}

/** A soma dos produtos, como a nota a imprime. */
export function totalDosItens(
  itens: Array<{ quantidade: number; valorUnitario: number }>,
): number {
  return centavos(itens.reduce((s, i) => s + centavos(i.quantidade * i.valorUnitario), 0));
}

/**
 * As parcelas, quando há, somam o total da nota — ao centavo. Parcela que não
 * fecha é conta a pagar errada esperando para nascer.
 */
export function conferirParcelas(
  parcelas: Array<{ vencimento: string; valor: number }>,
  total: number,
): void {
  if (parcelas.length === 0) return;
  const soma = centavos(parcelas.reduce((s, p) => s + p.valor, 0));
  if (Math.abs(soma - total) > 0.005) {
    throw new BadRequestException(
      `As parcelas somam ${dinheiro(soma)} e os produtos da nota, ${dinheiro(total)}. ` +
        'Acerte as parcelas ou os valores dos produtos.',
    );
  }
}

function dinheiro(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function lerParcelas(json: Prisma.JsonValue): ParcelaDaNota[] {
  return (Array.isArray(json) ? json : []) as unknown as ParcelaDaNota[];
}

/** "10 FITA ISOLANTE, 5 ONU" — o que a conta a pagar diz que foi comprado. */
function resumoDosItens(itens: CompraLancada['itens']): string {
  return itens
    .filter((i) => i.entrou)
    .map((i) => `${Number(i.quantidade)} ${i.descricao}`)
    .join(', ');
}

function naTela(n: NotaDeCompra): NotaNaTela {
  return {
    id: n.id,
    numeroNota: n.numeroNota,
    fornecedor: { id: n.idFornecedorIxc, nome: n.fornecedorNome },
    dataEmissao: n.dataEmissao.toISOString().slice(0, 10),
    almoxarifado: n.almoxarifado,
    valorTotal: Number(n.valorTotal),
    entradaId: n.idEntradaIxc,
    compraAberta: n.compraAberta,
    itens: n.itens as unknown as CompraLancada['itens'],
    parcelas: lerParcelas(n.parcelas),
    situacao: n.situacao as NotaNaTela['situacao'],
    lancadaPor: n.lancadaPor,
    lancadaEm: n.createdAt.toISOString(),
    decididaPor: n.decididaPor,
    motivoDaRecusa: n.motivoDaRecusa,
  };
}
