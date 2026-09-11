import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IxcClient } from '../ixc/ixc.client';
import {
  chaveDoNegativo,
  negativosParaAcertar,
  valorUnitarioDoAcerto,
  type NegativoDeFora,
  type NegativoParaAcertar,
  type ValorDoAcerto,
} from './acerto-negativos';
import { EstoqueService } from './estoque.service';
import { ProdutosService } from './produtos.service';
import { hojeParaIxc, montarEntrada, montarItemDaEntrada } from './produtos-ixc';

/** Os negativos de agora: o que o acerto zera e o que fica. */
export interface NegativosNaTela {
  itens: NegativoParaAcertar[];
  deFora: NegativoDeFora[];
}

export interface PedidoDeAcerto {
  fornecedorId: number;
  tipoDocumentoId: number;
  condicaoPagamentoId: number;
  valor: ValorDoAcerto;
  /** As chaves ("produto:almox") marcadas na tela. */
  chaves: string[];
}

/** Uma linha do resultado, dita para gente ler. */
interface LinhaDoAcerto {
  chave: string;
  descricao: string;
  almoxarifado: string;
  quantidade: number;
  unidadeSigla: string;
}

/** O acerto rodando ou terminado. */
export interface AndamentoDoAcerto {
  id: string;
  status: 'rodando' | 'terminou' | 'falhou';
  total: number;
  feitos: number;
  /** As compras de acerto abertas no IXC — uma por filial. */
  compras: number[];
  lancados: LinhaDoAcerto[];
  falharam: Array<LinhaDoAcerto & { motivo: string }>;
  /**
   * Relido o estoque no fim: quantos dos lançados zeraram, e os que ainda
   * aparecem negativos (se o IXC só somar a compra depois de finalizada).
   * Null se a releitura falhou.
   */
  zerados: number | null;
  aindaNegativos: LinhaDoAcerto[] | null;
  erro: string | null;
  iniciadoEm: string;
  terminadoEm: string | null;
}

interface Quem {
  nome: string;
}

/** Quanto tempo um acerto terminado fica guardado para a tela ler o resultado. */
const GUARDA_MS = 6 * 60 * 60_000;

/**
 * Zera, de uma vez, os saldos negativos do estoque — pela compra de acerto
 * do IXC, que é o caminho documentado de o saldo subir (ver `darEntrada` em
 * `ProdutosService`).
 *
 * Uma compra só por filial, com um item por produto × almoxarifado, na
 * quantidade exata que zera. Os itens entram um por vez: a transferência
 * mostrou que o IXC tropeça em inserções simultâneas numa movimentação
 * recém-aberta. Roda em segundo plano — cem itens passam do minuto que o
 * nginx dá à requisição —, e a tela acompanha por `andamento`.
 *
 * O que já foi lançado e ainda não subiu (se o IXC só somar a compra depois de
 * finalizada) é lembrado aqui e não é lançado de novo: rodar duas vezes daria
 * o dobro, e o saldo iria de negativo a positivo sem ninguém ter comprado nada.
 */
@Injectable()
export class AcertoDeNegativosService {
  private readonly logger = new Logger(AcertoDeNegativosService.name);
  private readonly andamentos = new Map<string, AndamentoDoAcerto>();
  /** chave → a compra em que ela já entrou. */
  private readonly lancados = new Map<string, number>();
  private rodando = false;

  constructor(
    private readonly ixc: IxcClient,
    private readonly estoque: EstoqueService,
    private readonly produtos: ProdutosService,
  ) {}

  /** Os negativos de agora, lidos de novo do IXC. */
  async listar(): Promise<NegativosNaTela> {
    const lido = await this.estoque.listar({ recarregar: true });
    const comNegativo = lido.itens.filter((i) => i.saldos.some((s) => s.saldo < 0));
    const [[unidades, almoxarifados], cadastros] = await Promise.all([
      this.produtos.paraMovimentar(),
      this.produtos.cadastrosPorId(comNegativo.map((i) => i.produtoId)),
    ]);
    const r = negativosParaAcertar(comNegativo, cadastros, unidades, almoxarifados);

    // Lançado e ainda negativo: a compra está lá, esperando o IXC somar.
    const itens: NegativoParaAcertar[] = [];
    const deFora = [...r.deFora];
    for (const i of r.itens) {
      const compra = this.lancados.get(i.chave);
      if (compra) {
        deFora.push({
          chave: i.chave,
          produtoId: i.produtoId,
          descricao: i.descricao,
          almoxarifado: i.almoxarifado,
          saldo: i.saldo,
          motivo:
            `já está na compra de acerto #${compra} — se o saldo não subiu, finalize ` +
            'essa compra no IXC; lançar de novo daria o dobro',
        });
      } else {
        itens.push(i);
      }
    }
    return { itens, deFora };
  }

  async iniciar(pedido: PedidoDeAcerto, quem: Quem): Promise<AndamentoDoAcerto> {
    if (this.rodando) {
      throw new BadRequestException('Já tem um acerto rodando. Espere ele terminar.');
    }
    this.rodando = true;
    try {
      const { itens } = await this.listar();
      const marcadas = new Set(pedido.chaves);
      const escolhidos = itens.filter((i) => marcadas.has(i.chave));
      if (escolhidos.length === 0) {
        throw new BadRequestException(
          'Nada para acertar — os marcados já não estão negativos ou já foram lançados.',
        );
      }

      const a: AndamentoDoAcerto = {
        id: randomUUID(),
        status: 'rodando',
        total: escolhidos.length,
        feitos: 0,
        compras: [],
        lancados: [],
        falharam: [],
        zerados: null,
        aindaNegativos: null,
        erro: null,
        iniciadoEm: new Date().toISOString(),
        terminadoEm: null,
      };
      this.esquecerVelhos();
      this.andamentos.set(a.id, a);
      this.logger.log(
        `${quem.nome} começou o acerto de ${escolhidos.length} saldo(s) negativo(s) ` +
          `(valor: ${pedido.valor === 'centavo' ? 'R$ 0,01' : 'preço base'}).`,
      );
      void this.executar(a, escolhidos, pedido);
      return a;
    } catch (err) {
      this.rodando = false;
      throw err;
    }
  }

  andamento(id: string): AndamentoDoAcerto {
    const a = this.andamentos.get(id);
    if (!a) {
      throw new NotFoundException(
        'Esse acerto não está mais aqui (o servidor pode ter reiniciado). O que foi lançado ' +
          'está nas compras de acerto do IXC — confira lá antes de rodar de novo.',
      );
    }
    return a;
  }

  private async executar(
    a: AndamentoDoAcerto,
    itens: NegativoParaAcertar[],
    pedido: PedidoDeAcerto,
  ): Promise<void> {
    try {
      const data = hojeParaIxc();
      const porFilial = new Map<number, NegativoParaAcertar[]>();
      for (const i of itens) {
        porFilial.set(i.filialId, [...(porFilial.get(i.filialId) ?? []), i]);
      }

      for (const [filialId, daFilial] of porFilial) {
        const valorTotal =
          Math.round(
            daFilial.reduce((s, i) => s + i.quantidade * valorUnitarioDoAcerto(i, pedido.valor), 0) *
              100,
          ) / 100;
        let entradaId: number | null = null;
        try {
          ({ id: entradaId } = await this.ixc.create(
            'entrada',
            montarEntrada({
              tipoDocumentoId: pedido.tipoDocumentoId,
              fornecedorId: pedido.fornecedorId,
              condicaoPagamentoId: pedido.condicaoPagamentoId,
              filialId,
              data,
              numeroNota: '',
              valorTotal,
            }),
          ));
        } catch (err) {
          const motivo = err instanceof Error ? err.message : String(err);
          for (const i of daFilial) {
            a.falharam.push({ ...linhaDe(i), motivo: `a compra de acerto não abriu (${motivo})` });
            a.feitos += 1;
          }
          continue;
        }
        if (!entradaId) {
          for (const i of daFilial) {
            a.falharam.push({
              ...linhaDe(i),
              motivo: 'o IXC não devolveu o número da compra de acerto',
            });
            a.feitos += 1;
          }
          continue;
        }
        a.compras.push(entradaId);

        // Um por vez: ver PAUSA_ANTES_DE_REPETIR_MS em transferencias.service.
        for (const i of daFilial) {
          try {
            await this.ixc.create(
              'movimento_produtos',
              montarItemDaEntrada(entradaId, {
                produtoId: i.produtoId,
                unidadeId: i.unidadeId,
                unidadeSigla: i.unidadeSigla,
                almoxId: i.almoxId,
                filialId: i.filialId,
                quantidade: i.quantidade,
                valorUnitario: valorUnitarioDoAcerto(i, pedido.valor),
                data,
              }),
            );
            a.lancados.push(linhaDe(i));
            this.lancados.set(i.chave, entradaId);
          } catch (err) {
            const motivo = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Acerto (compra #${entradaId}): o IXC recusou produto #${i.produtoId} ` +
                `"${i.descricao}" (tipo ${i.tipoProduto}) em ${i.almoxarifado}: ${motivo}`,
            );
            a.falharam.push({ ...linhaDe(i), motivo });
          } finally {
            a.feitos += 1;
          }
        }
      }

      // A conferência: o que o IXC tem agora, e não o que foi mandado.
      this.estoque.esquecer();
      try {
        const depois = await this.estoque.listar({ recarregar: true });
        const saldo = new Map<string, number>();
        for (const item of depois.itens) {
          for (const s of item.saldos) saldo.set(chaveDoNegativo(item.produtoId, s.almoxId), s.saldo);
        }
        const ainda = a.lancados.filter((l) => (saldo.get(l.chave) ?? 0) < -1e-6);
        a.aindaNegativos = ainda;
        a.zerados = a.lancados.length - ainda.length;
        // O que zerou não precisa mais da trava contra lançar de novo.
        for (const l of a.lancados) {
          if (!ainda.some((x) => x.chave === l.chave)) this.lancados.delete(l.chave);
        }
      } catch {
        a.zerados = null;
        a.aindaNegativos = null;
      }
      a.status = 'terminou';
    } catch (err) {
      a.status = 'falhou';
      a.erro = err instanceof Error ? err.message : String(err);
    } finally {
      a.terminadoEm = new Date().toISOString();
      this.rodando = false;
      this.logger.log(
        `Acerto de negativos (compras ${a.compras.map((c) => `#${c}`).join(', ') || 'nenhuma'}): ` +
          `${a.lancados.length} lançados, ${a.falharam.length} recusados, ` +
          `${a.zerados ?? '?'} zerados na releitura.`,
      );
    }
  }

  private esquecerVelhos(): void {
    const limite = Date.now() - GUARDA_MS;
    for (const [id, a] of this.andamentos) {
      if (a.terminadoEm && Date.parse(a.terminadoEm) < limite) this.andamentos.delete(id);
    }
  }
}

function linhaDe(i: NegativoParaAcertar): LinhaDoAcerto {
  return {
    chave: i.chave,
    descricao: i.descricao,
    almoxarifado: i.almoxarifado,
    quantidade: i.quantidade,
    unidadeSigla: i.unidadeSigla,
  };
}
