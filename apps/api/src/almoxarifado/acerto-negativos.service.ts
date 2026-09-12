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
import { numeroDoIxc } from './estoque.mapper';
import { EstoqueService } from './estoque.service';
import { ProdutosService } from './produtos.service';
import {
  DOCUMENTO_DO_ACERTO,
  hojeParaIxc,
  montarEntrada,
  montarItemDaEntrada,
} from './produtos-ixc';

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

/** Uma compra de acerto aberta sendo desfeita: os itens apagados um por um, e a compra. */
export interface DesfazimentoDaCompra {
  id: string;
  entradaId: number;
  status: 'rodando' | 'terminou' | 'falhou';
  total: number;
  feitos: number;
  falharam: Array<{ descricao: string; motivo: string }>;
  erro: string | null;
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
  private readonly desfazimentos = new Map<string, DesfazimentoDaCompra>();
  private rodando = false;

  constructor(
    private readonly ixc: IxcClient,
    private readonly estoque: EstoqueService,
    private readonly produtos: ProdutosService,
  ) {}

  /** Os negativos de agora, lidos de novo do IXC. */
  async listar(): Promise<NegativosNaTela> {
    const lido = await this.estoque.listar({ recarregar: true });
    /*
     * Produto inativo fica de fora: ele saiu de circulação, e ninguém vai dar
     * entrada de compra para acertar o saldo de algo que a casa não usa mais.
     * O negativo dele continua à vista no Estoque, marcando "Mostrar
     * inativos" — que é onde se reativa, se um dia for o caso.
     */
    const comNegativo = lido.itens.filter(
      (i) => i.ativo && i.saldos.some((s) => s.saldo < 0),
    );
    const inativosComNegativo = lido.itens.filter(
      (i) => !i.ativo && i.saldos.some((s) => s.saldo < 0),
    ).length;
    if (inativosComNegativo > 0) {
      this.logger.log(
        `${inativosComNegativo} produto(s) inativo(s) com saldo negativo fora da tela de ` +
          'acerto — inativo não se compra para acertar.',
      );
    }
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

  /**
   * Desfaz uma compra de acerto **aberta**: apaga os itens, um por vez, e a
   * compra. O saldo volta ao que era — os negativos reaparecem, e o acerto
   * pode ser refeito. Existe por causa das compras de 11/09/2026, gravadas com
   * o valor unitário cem vezes maior (ver `dinheiroDaCompra`); aberta, a
   * compra ainda não gerou custo nem financeiro, e apagar é o jeito limpo.
   * Compra finalizada não se desfaz aqui.
   */
  async desfazer(entradaId: number, quem: Quem): Promise<DesfazimentoDaCompra> {
    if (this.rodando) {
      throw new BadRequestException('Já tem um acerto rodando. Espere ele terminar.');
    }
    const { entrada, itens } = await this.produtos.entradaCrua(entradaId);
    if (!entrada) throw new NotFoundException(`A compra #${entradaId} não existe no IXC.`);
    if (String(entrada.documento ?? '').trim() !== DOCUMENTO_DO_ACERTO) {
      throw new BadRequestException(
        `A compra #${entradaId} não foi feita pelo acerto de negativos do sistema — ` +
          'daqui só se desfaz compra de acerto. As outras são do IXC, e fazem parte do saldo.',
      );
    }
    if (String(entrada.status ?? '').toUpperCase() !== 'A') {
      throw new BadRequestException(
        `A compra #${entradaId} já foi finalizada no IXC — daqui só se desfaz compra aberta.`,
      );
    }
    this.rodando = true;
    const d: DesfazimentoDaCompra = {
      id: randomUUID(),
      entradaId,
      status: 'rodando',
      total: itens.length,
      feitos: 0,
      falharam: [],
      erro: null,
    };
    this.desfazimentos.set(d.id, d);
    this.logger.log(`${quem.nome} começou a desfazer a compra de acerto #${entradaId} (${itens.length} itens).`);
    void (async () => {
      try {
        for (const i of itens) {
          try {
            await this.ixc.remove('movimento_produtos', numeroDoIxc(i.id));
          } catch (err) {
            d.falharam.push({
              descricao: String(i.descricao ?? `produto #${numeroDoIxc(i.id_produto)}`),
              motivo: err instanceof Error ? err.message : String(err),
            });
          } finally {
            d.feitos += 1;
          }
        }
        if (d.falharam.length === 0) await this.ixc.remove('entrada', entradaId);
        for (const [chave, compra] of this.lancados) {
          if (compra === entradaId) this.lancados.delete(chave);
        }
        d.status = 'terminou';
      } catch (err) {
        d.status = 'falhou';
        d.erro = err instanceof Error ? err.message : String(err);
      } finally {
        this.estoque.esquecer();
        this.rodando = false;
        this.logger.log(
          `Compra de acerto #${entradaId}: ${d.feitos - d.falharam.length} itens apagados, ` +
            `${d.falharam.length} recusados${d.erro ? ` (${d.erro})` : ''}.`,
        );
      }
    })();
    return d;
  }

  desfazimento(id: string): DesfazimentoDaCompra {
    const d = this.desfazimentos.get(id);
    if (!d) throw new NotFoundException('Esse desfazimento não está mais aqui — confira a compra no IXC.');
    return d;
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
      const naoAbriu: string[] = [];
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
              documento: DOCUMENTO_DO_ACERTO,
              valorTotal,
            }),
          ));
        } catch (err) {
          const motivo = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Acerto: o IXC não abriu a compra de acerto da filial ${filialId}: ${motivo}`);
          naoAbriu.push(motivo);
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

      // Nenhuma compra abriu: nada foi lançado, e é isso que se diz — uma vez.
      if (a.compras.length === 0) {
        a.falharam = [];
        a.status = 'falhou';
        a.erro =
          `o IXC não abriu a compra de acerto (${naoAbriu[0] ?? 'sem resposta'}). ` +
          'Nada foi lançado — o saldo está como antes';
        return;
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
