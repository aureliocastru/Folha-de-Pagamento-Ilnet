import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ItemDoPacote } from '@prisma/client';
import { lerDataUrl } from '../arquivos/data-url';
import { ehDiaUtil } from '../contas-abertas/dias-uteis';
import { TIPO_RECIBO } from '../rh/recibos.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConfiguracaoContabilService,
  SUGESTAO,
  type Configuracao,
  type Selecao,
} from './configuracao.service';
import { diaBr } from './ixc-leitura';
import { ITENS, type ItemDoPapel } from './itens';
import {
  GRUPO_DO_ITEM,
  LEITURA_ABANDONADA_MS,
  LeitorDoPacoteService,
  type ContaDoPacote,
  type DadosDasSaidas,
  type Grupo,
} from './leitor.service';
import { lerOfx } from './ofx';
import { relatorioDoSaldoDoCaixa, saldoNoDia, type CaixaNoPeriodo } from './relatorios/caixa';
import {
  relatorioDeDescontos,
  resumoDePagamentos,
  textoDoComprovante,
  type Comprovante,
  type Pagamento,
  type SituacaoDoComprovante,
} from './relatorios/pagamentos';
import type { LinhaDoResumo } from './relatorios/relatorio';
import { moeda, quantidade, soma } from './relatorios/relatorio';

/** O teto de cada arquivo. O corpo do pedido aceita 24 MB em base64. */
const LIMITE_BYTES = 15 * 1024 * 1024;

export type Estado = 'pronto' | 'falta' | 'atencao' | 'lendo' | 'erro' | 'nao_teve';

export interface ArquivoNaTela {
  id: string;
  nome: string;
  tamanho: number;
  createdAt: Date;
}

/** Um lugar onde um arquivo (ou um valor) é esperado. */
export interface Vaga {
  chave: string;
  rotulo: string;
  /** "arquivo" recebe arquivos; "valor" recebe um número (o saldo contado). */
  tipo: 'arquivo' | 'valor';
  /** O que o seletor de arquivos aceita (`accept` do input). */
  aceita: string;
  obrigatoria: boolean;
  multiplo: boolean;
  arquivos: ArquivoNaTela[];
  /** Marcado como "não tem" — com o motivo. */
  naoTem: boolean;
  motivo: string | null;
  /** O que se escreve no botão de dizer que não tem. Vazio = não oferece. */
  rotuloDoNaoTem: string;
  valor?: number | null;
  /** Agrupa as vagas na tela (o nome da conta, do cartão). */
  grupo?: string;
}

export interface ItemNaTela extends ItemDoPapel {
  estado: Estado;
  resumo: LinhaDoResumo[];
  avisos: string[];
  /** O que falta, em frases curtas. */
  pendencias: string[];
  erro: string | null;
  lidoEm: Date | null;
  naoTeve: boolean;
  observacao: string | null;
  vagas: Vaga[];
  /** Tem planilha para baixar. */
  temPlanilha: boolean;
  /** Tem lista de pagamentos com comprovante (8, 13, 14, 18). */
  temLista: boolean;
  /** Os ajustes que mexem neste item (papel das contas, seleção). */
  ajuste: 'contas' | 'lucros' | 'doacoes' | 'link' | null;
}

export interface PacoteNaTela {
  id: string;
  de: string;
  ate: string;
  prazo: string;
  lendo: boolean;
  leituraEm: Date | null;
  leituraFimEm: Date | null;
  baixadoEm: Date | null;
  itens: ItemNaTela[];
  prontos: number;
}

/** O 5º dia útil do mês seguinte ao fim do período — o prazo do papel. */
export function prazoDoPacote(ate: string): string {
  const [a, m] = ate.split('-').map(Number);
  let dia = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1));
  let uteis = 0;
  for (;;) {
    // `ehDiaUtil` lê o dia em UTC, que é como `dia` foi montado.
    if (ehDiaUtil(dia)) uteis += 1;
    if (uteis === 5) return dia.toISOString().slice(0, 10);
    dia = new Date(dia.getTime() + 86_400_000);
  }
}

function diaIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A data "AAAA-MM-DD" vira o dia no banco (`@db.Date`), sem fuso no meio. */
function dataDoDia(dia: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new BadRequestException('Data no formato AAAA-MM-DD.');
  const d = new Date(`${dia}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || diaIso(d) !== dia) throw new BadRequestException(`A data ${dia} não existe.`);
  return d;
}

/** Os dados guardados de um item, lidos do JSON. */
function dadosDe<T>(linha: { dados: Prisma.JsonValue } | undefined): T | null {
  return (linha?.dados ?? null) as T | null;
}

/** O tipo pela extensão, para o que o navegador manda como "octet-stream". */
const TIPO_POR_EXTENSAO: Record<string, string> = {
  pdf: 'application/pdf',
  ofx: 'application/x-ofx',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

@Injectable()
export class PacoteContabilService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leitor: LeitorDoPacoteService,
    private readonly configuracao: ConfiguracaoContabilService,
  ) {}

  // -------------------------------------------------------------------------
  // Pacotes
  // -------------------------------------------------------------------------

  async listar() {
    const pacotes = await this.prisma.pacoteContabil.findMany({ orderBy: [{ ate: 'desc' }, { de: 'desc' }] });
    return pacotes.map((p) => ({
      id: p.id,
      de: diaIso(p.de),
      ate: diaIso(p.ate),
      prazo: prazoDoPacote(diaIso(p.ate)),
      leituraEm: p.leituraEm,
      leituraFimEm: p.leituraFimEm,
      baixadoEm: p.baixadoEm,
      lendo: this.lendo(p),
    }));
  }

  /**
   * Abre o período — ou devolve o que já existe com as mesmas datas — e manda
   * ler o IXC. O período é livre: de 01/09 a 30/09 é o comum.
   */
  async abrir(de: string, ate: string, usuarioId?: string) {
    const inicio = dataDoDia(de);
    const fim = dataDoDia(ate);
    if (inicio > fim) throw new BadRequestException('A data inicial é depois da final.');
    if (fim.getTime() - inicio.getTime() > 366 * 86_400_000) {
      throw new BadRequestException('O período passa de um ano. A contabilidade pede mês a mês.');
    }
    const hoje = diaIso(new Date());
    if (de > hoje) throw new BadRequestException('O período começa no futuro.');

    const existente = await this.prisma.pacoteContabil.findUnique({ where: { de_ate: { de: inicio, ate: fim } } });
    if (existente) return { id: existente.id, novo: false };

    const criado = await this.prisma.pacoteContabil.create({
      data: { de: inicio, ate: fim, criadoPor: usuarioId ?? null },
    });
    this.leitor.iniciar(criado.id);
    return { id: criado.id, novo: true };
  }

  async apagar(id: string): Promise<void> {
    await this.pacote(id);
    await this.prisma.pacoteContabil.delete({ where: { id } });
  }

  /** Lê de novo o IXC: tudo, ou só os grupos dos itens pedidos. */
  async lerDeNovo(id: string, itens?: number[]): Promise<void> {
    await this.pacote(id);
    const grupos = [...new Set((itens ?? []).map((i) => GRUPO_DO_ITEM[i]).filter((g): g is Grupo => !!g))];
    this.leitor.iniciar(id, grupos);
  }

  private async pacote(id: string) {
    const p = await this.prisma.pacoteContabil.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Este período não existe mais.');
    return p;
  }

  private lendo(p: { id: string; leituraEm: Date | null; leituraFimEm: Date | null }): boolean {
    if (this.leitor.estaLendo(p.id)) return true;
    return !!p.leituraEm && !p.leituraFimEm && Date.now() - p.leituraEm.getTime() < LEITURA_ABANDONADA_MS;
  }

  // -------------------------------------------------------------------------
  // A tela: os vinte itens, com o que está pronto e o que falta
  // -------------------------------------------------------------------------

  async abrirNaTela(id: string): Promise<PacoteNaTela> {
    const p = await this.pacote(id);
    const de = diaIso(p.de);
    const ate = diaIso(p.ate);
    const lendo = this.lendo(p);

    const [linhas, arquivos, contratos, cfg] = await Promise.all([
      this.itensSemPeso(id),
      this.prisma.arquivoContabil.findMany({
        where: { pacoteId: id },
        select: { id: true, item: true, chave: true, nome: true, tamanho: true, createdAt: true, tipo: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.contratosVigentes(de, ate),
      this.configuracao.obter(),
    ]);

    const linha = (item: number, chave = '') => linhas.find((l) => l.item === item && l.chave === chave);
    const arquivosDe = (item: number, chave: string): ArquivoNaTela[] =>
      arquivos
        .filter((a) => a.item === item && a.chave === chave)
        .map((a) => ({ id: a.id, nome: a.nome, tamanho: a.tamanho, createdAt: a.createdAt }));
    const marca = (item: number, chave: string) => {
      const l = linha(item, chave);
      return { naoTem: l?.naoTeve ?? false, motivo: l?.observacao ?? null };
    };

    const contas = dadosDe<{ contas: ContaDoPacote[] }>(linha(1))?.contas ?? [];
    const saidas = dadosDe<DadosDasSaidas>(linha(8));
    const comprovantes = saidas ? await this.comprovantes(id, saidas) : new Map<number, SituacaoDoComprovante>();

    const itens: ItemNaTela[] = ITENS.map((papel) => {
      const base = linha(papel.numero);
      const item: ItemNaTela = {
        ...papel,
        estado: 'falta',
        resumo: ((base?.resumo as unknown) as LinhaDoResumo[] | null) ?? [],
        avisos: ((base?.avisos as unknown) as string[] | null) ?? [],
        pendencias: [],
        erro: base?.erro ?? null,
        lidoEm: base?.lidoEm ?? null,
        naoTeve: base?.naoTeve ?? false,
        observacao: base?.observacao ?? null,
        vagas: [],
        temPlanilha: false,
        temLista: false,
        ajuste: null,
      };
      this.montarItem(item, {
        de,
        ate,
        base,
        contas,
        saidas,
        comprovantes,
        cfg,
        contratos,
        linha,
        arquivosDe,
        marca,
      });
      return this.decidirEstado(item, lendo, base);
    });

    return {
      id: p.id,
      de,
      ate,
      prazo: prazoDoPacote(ate),
      lendo,
      leituraEm: p.leituraEm,
      leituraFimEm: p.leituraFimEm,
      baixadoEm: p.baixadoEm,
      itens,
      prontos: itens.filter((i) => ['pronto', 'atencao', 'nao_teve'].includes(i.estado)).length,
    };
  }

  /**
   * As linhas do pacote como a tela precisa delas.
   *
   * O `dados` do saldo de clientes e do faturamento são as planilhas inteiras
   * — oito mil títulos, alguns megabytes —, e a tela que acompanha a leitura
   * pede o pacote a cada três segundos. Só vêm os `dados` que a tela usa: as
   * contas (1), os pagamentos (8), o caixa (10) e as faturas do cartão (15).
   */
  private async itensSemPeso(pacoteId: string): Promise<ItemDoPacote[]> {
    const [linhas, comDados] = await Promise.all([
      this.prisma.itemDoPacote.findMany({
        where: { pacoteId },
        select: {
          id: true,
          pacoteId: true,
          item: true,
          chave: true,
          naoTeve: true,
          observacao: true,
          resumo: true,
          avisos: true,
          lidoEm: true,
          erro: true,
          marcadoPor: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.itemDoPacote.findMany({
        where: { pacoteId, chave: '', item: { in: [1, 8, 10, 15] } },
        select: { id: true, dados: true },
      }),
    ]);
    const dados = new Map(comDados.map((l) => [l.id, l.dados]));
    return linhas.map((l) => {
      let d = dados.get(l.id) ?? null;
      // A fatura do cartão guarda a planilha junto: só as faturas interessam.
      if (l.item === 15 && d && typeof d === 'object' && !Array.isArray(d)) {
        d = { faturas: (d as { faturas?: Prisma.JsonValue }).faturas ?? [] } as Prisma.JsonValue;
      }
      return { ...l, dados: d };
    });
  }

  /** O estado final do item, depois de montado. */
  private decidirEstado(
    item: ItemNaTela,
    lendo: boolean,
    base: { lidoEm: Date | null; erro: string | null } | undefined,
  ): ItemNaTela {
    const doIxc = GRUPO_DO_ITEM[item.numero] !== undefined;
    // Os que não guardam leitura própria: montados da leitura de outro item.
    const lido = !!base?.lidoEm || [9, 11, 13, 14, 18, 20].includes(item.numero);

    if (item.naoTeve && item.podeNaoTer) {
      item.estado = 'nao_teve';
      item.pendencias = [];
      return item;
    }
    if (lendo && doIxc && !lido) {
      item.estado = 'lendo';
      return item;
    }
    if (item.erro && doIxc) {
      item.estado = 'erro';
      return item;
    }
    if (doIxc && !lido && item.origem !== 'arquivo') {
      item.estado = lendo ? 'lendo' : 'falta';
      if (!lendo) item.pendencias.unshift('Ainda não foi lido do IXC.');
      return item;
    }
    if (item.pendencias.length > 0) {
      item.estado = 'falta';
      return item;
    }
    item.estado = item.avisos.length > 0 ? 'atencao' : 'pronto';
    return item;
  }

  private montarItem(
    item: ItemNaTela,
    c: {
      de: string;
      ate: string;
      base: ItemDoPacote | undefined;
      contas: ContaDoPacote[];
      saidas: DadosDasSaidas | null;
      comprovantes: Map<number, SituacaoDoComprovante>;
      cfg: Configuracao;
      contratos: ArquivoNaTela[];
      linha: (item: number, chave?: string) => ItemDoPacote | undefined;
      arquivosDe: (item: number, chave: string) => ArquivoNaTela[];
      marca: (item: number, chave: string) => { naoTem: boolean; motivo: string | null };
    },
  ): void {
    const vaga = (v: Partial<Vaga> & Pick<Vaga, 'chave' | 'rotulo'>, numeroDoItem = item.numero): Vaga => {
      const m = c.marca(numeroDoItem, v.chave);
      return {
        tipo: 'arquivo',
        aceita: '*',
        obrigatoria: true,
        multiplo: false,
        rotuloDoNaoTem: '',
        ...v,
        arquivos: c.arquivosDe(numeroDoItem, v.chave),
        naoTem: m.naoTem,
        motivo: m.motivo,
      };
    };
    const falta = (v: Vaga) => v.obrigatoria && v.arquivos.length === 0 && !v.naoTem;
    // As linhas do relatório não vêm para a tela (ver `itensSemPeso`): lido e
    // sem erro de leitura nenhuma vez é ter o que baixar.
    const temRelatorio = !!c.base?.lidoEm;

    switch (item.numero) {
      case 1: {
        item.ajuste = 'contas';
        const contas = c.contas.filter((k) => k.papel === 'extrato' && k.movimentos > 0);
        for (const conta of contas) {
          const grupo = rotuloDaConta(conta);
          item.vagas.push(
            vaga({ chave: `conta:${conta.id}:pdf`, rotulo: 'PDF', aceita: '.pdf', grupo, rotuloDoNaoTem: 'O banco não fornece' }),
            vaga({ chave: `conta:${conta.id}:excel`, rotulo: 'Excel', aceita: '.xls,.xlsx,.csv', grupo, rotuloDoNaoTem: 'O banco não fornece' }),
            vaga({ chave: `conta:${conta.id}:ofx`, rotulo: 'OFX', aceita: '.ofx', grupo, rotuloDoNaoTem: 'O banco não fornece' }),
          );
        }
        const faltando = contas.filter((k) => item.vagas.some((v) => v.grupo === rotuloDaConta(k) && falta(v)));
        if (faltando.length > 0) item.pendencias.push(`Falta extrato de ${faltando.map((k) => k.nome).join(', ')}.`);
        const parados = c.contas.filter((k) => k.papel === 'extrato' && k.movimentos === 0 && k.ativa);
        if (parados.length > 0) {
          item.resumo = [{ rotulo: 'Sem movimento no período', valor: parados.map((k) => k.nome).join(', '), tipo: 'texto' }];
        }
        if (c.contas.length === 0 && !c.base) item.pendencias.push('Ainda não foi lido do IXC.');
        return;
      }

      case 2: {
        item.ajuste = 'contas';
        const contas = c.contas.filter((k) => k.papel === 'aplicacao' && (k.movimentos > 0 || k.ativa));
        for (const conta of contas) {
          item.vagas.push(
            vaga({
              chave: `conta:${conta.id}:extrato`,
              rotulo: conta.nome,
              obrigatoria: conta.movimentos > 0,
              multiplo: true,
              rotuloDoNaoTem: 'Não teve movimento',
            }),
          );
        }
        item.vagas.push(vaga({ chave: 'outros', rotulo: 'Outros extratos de aplicação', obrigatoria: false, multiplo: true }));
        this.exigirAlgoOuNaoTeve(item, 'Envie o extrato da aplicação ou marque que não teve.');
        for (const v of item.vagas) if (falta(v)) item.pendencias.push(`Falta o extrato de ${v.rotulo}.`);
        return;
      }

      case 3: {
        const v = vaga({ chave: 'contrato', rotulo: 'Contratos em vigor', obrigatoria: false, multiplo: true });
        v.arquivos = c.contratos;
        item.vagas.push(v);
        if (c.contratos.length === 0 && !item.naoTeve) {
          item.pendencias.push('Envie os contratos de empréstimo em vigor ou marque que não tem.');
        }
        return;
      }

      case 4: {
        item.vagas.push(vaga({ chave: 'outros', rotulo: 'Extratos de operações de crédito', obrigatoria: false, multiplo: true }));
        this.exigirAlgoOuNaoTeve(item, 'Envie os extratos ou marque que não teve.');
        return;
      }

      case 5:
      case 6:
      case 7:
      case 12:
      case 17:
      case 19:
        item.temPlanilha = temRelatorio;
        return;

      case 8: {
        item.temLista = true;
        item.temPlanilha = !!c.saidas;
        if (!c.saidas) return;
        const lista = c.saidas.pagamentos;
        const faltam = lista.filter((p) => textoDoComprovante(c.comprovantes.get(p.idFnApagar)) === 'FALTA');
        item.resumo = [
          moeda('Saiu no período', soma(lista, (p) => p.pago), true),
          quantidade('Pagamentos', lista.length),
          quantidade('Com comprovante', lista.length - faltam.length),
        ];
        if (faltam.length > 0) item.pendencias.push(`Faltam ${faltam.length} comprovantes de pagamento.`);
        return;
      }

      case 9: {
        const contas = c.contas.filter((k) => k.papel === 'extrato' && k.movimentos > 0);
        const resumo: LinhaDoResumo[] = [];
        for (const conta of contas) {
          const l = c.linha(9, `conta:${conta.id}`);
          const temOfx = c.arquivosDe(1, `conta:${conta.id}:ofx`).length > 0;
          const naoFornece = c.marca(1, `conta:${conta.id}:ofx`).naoTem;
          if (l?.erro) {
            item.pendencias.push(`${conta.nome}: ${l.erro}`);
          } else if (l?.resumo) {
            const r = (l.resumo as unknown) as LinhaDoResumo[];
            const so = r.filter((x) => /^Só no/.test(x.rotulo)).reduce((s, x) => s + Number(x.valor), 0);
            resumo.push({ rotulo: conta.nome, valor: so === 0 ? 'bate' : `${so} diferenças`, tipo: 'texto' });
          } else if (naoFornece) {
            resumo.push({ rotulo: conta.nome, valor: 'sem OFX', tipo: 'texto' });
          } else if (!temOfx) {
            item.pendencias.push(`Envie o OFX de ${conta.nome} (item 1).`);
          } else {
            item.pendencias.push(`${conta.nome}: o OFX chegou e ainda não foi conferido.`);
          }
          item.avisos.push(...(((l?.avisos as unknown) as string[] | null) ?? []));
        }
        item.resumo = resumo;
        item.temPlanilha = resumo.length > 0;
        return;
      }

      case 10: {
        const caixas = dadosDe<{ caixas: CaixaNoPeriodo[] }>(c.base)?.caixas;
        item.temPlanilha = !!caixas;
        if (!caixas) return;
        const lanc = caixas.flatMap((k) => k.lancamentos);
        item.resumo = [
          moeda('Entradas', soma(lanc.filter((l) => l.tipo === 'ENTRADA'), (l) => l.valor)),
          moeda('Saídas', soma(lanc.filter((l) => l.tipo === 'SAIDA'), (l) => l.valor)),
          quantidade('Conferidos', lanc.filter((l) => l.conferido).length),
          quantidade('Lançamentos', lanc.length),
        ];
        const semConferir = caixas
          .map((k) => ({ nome: k.nome, n: k.lancamentos.filter((l) => l.tipo === 'SAIDA' && !l.conferido).length }))
          .filter((x) => x.n > 0);
        item.avisos = semConferir.map((x) => `${x.nome}: ${x.n} saídas não conferidas no Fechamento de Caixa.`);
        return;
      }

      case 11: {
        const caixas = this.caixasComInformado(c.linha);
        if (!caixas) {
          item.pendencias.push('Ainda não foi lido do IXC.');
          return;
        }
        const r = relatorioDoSaldoDoCaixa({ ate: c.ate, caixas });
        item.resumo = r.resumo;
        item.temPlanilha = true;
        item.lidoEm = c.linha(10)?.lidoEm ?? null;
        for (const k of caixas) {
          const s = saldoNoDia(k, c.ate);
          if (s.como.startsWith('Calculado:')) {
            item.avisos.push(`${k.nome}: calculado, não contado (o último fechamento é de ${diaBr(k.fechadoAte)}).`);
          }
          const precisa = s.valor === null || s.como === 'Informado aqui';
          if (!precisa) continue;
          item.vagas.push({
            ...vaga({ chave: `caixa:${k.caixaId}`, rotulo: `Quanto havia em ${k.nome} em ${diaBr(c.ate)}`, tipo: 'valor' }),
            valor: k.informado,
          });
          if (s.valor === null) item.pendencias.push(`Informe o saldo de ${k.nome} em ${diaBr(c.ate)}.`);
        }
        return;
      }

      case 13:
      case 14:
      case 18: {
        const qual = item.numero === 13 ? 'lucros' : item.numero === 14 ? 'link' : 'doacoes';
        item.ajuste = qual;
        item.temLista = true;
        // Aqui "não teve" é conta, e não marca: decide a lista.
        item.naoTeve = false;
        if (!c.saidas) {
          item.pendencias.push('Ainda não foi lido do IXC.');
          return;
        }
        const lista = this.recorte(c.saidas.pagamentos, qual, c.cfg);
        item.temPlanilha = lista.length > 0;
        item.resumo = resumoDePagamentos(
          lista,
          item.numero === 13 ? 'Distribuído aos sócios' : item.numero === 14 ? 'Pago em link' : 'Doado',
        );
        if (lista.length === 0) {
          // Nada no período: é a resposta, e o item está pronto sem ninguém
          // precisar marcar.
          item.naoTeve = true;
          return;
        }
        if (item.numero !== 13) {
          const faltam = lista.filter((p) => textoDoComprovante(c.comprovantes.get(p.idFnApagar)) === 'FALTA');
          if (faltam.length > 0) {
            item.pendencias.push(
              `Falta ${item.numero === 14 ? 'a nota fiscal' : 'o comprovante'} de ${faltam.length} pagamento${faltam.length > 1 ? 's' : ''}.`,
            );
          }
        }
        return;
      }

      case 15: {
        const dados = dadosDe<{ faturas?: Array<{ cartaoId: string; cartao: string; competencia: string; total: number }> }>(c.base);
        item.temPlanilha = temRelatorio;
        item.naoTeve = false;
        for (const f of dados?.faturas ?? []) {
          const grupo = `${f.cartao} — fatura ${f.competencia.slice(5)}/${f.competencia.slice(0, 4)}`;
          item.vagas.push(
            vaga({ chave: `cartao:${f.cartaoId}:${f.competencia}:fatura`, rotulo: 'Fatura (PDF)', aceita: '.pdf', grupo }),
            vaga({ chave: `cartao:${f.cartaoId}:${f.competencia}:notas`, rotulo: 'Notas das compras', obrigatoria: false, multiplo: true, grupo }),
          );
        }
        for (const v of item.vagas) if (falta(v)) item.pendencias.push(`Falta o PDF da ${v.grupo}.`);
        if (dados && (dados.faturas ?? []).length === 0) item.naoTeve = true;
        return;
      }

      case 16: {
        item.ajuste = 'contas';
        item.temPlanilha = temRelatorio;
        const contas = c.contas.filter((k) => k.papel === 'maquininha' && k.movimentos > 0);
        for (const conta of contas) {
          item.vagas.push(
            vaga({ chave: `conta:${conta.id}:relatorio`, rotulo: `Relatório da operadora — ${conta.nome}`, multiplo: true }),
          );
        }
        item.vagas.push(vaga({ chave: 'outros', rotulo: 'Outras maquininhas', obrigatoria: false, multiplo: true }));
        for (const v of item.vagas) if (falta(v)) item.pendencias.push(`Falta o ${v.rotulo.charAt(0).toLowerCase()}${v.rotulo.slice(1)}.`);
        if (contas.length === 0) this.exigirAlgoOuNaoTeve(item, 'Envie o relatório da maquininha ou marque que não teve.');
        return;
      }

      case 20: {
        if (!c.saidas) {
          item.pendencias.push('Ainda não foi lido do IXC.');
          return;
        }
        const r = relatorioDeDescontos({ de: c.de, ate: c.ate, lidoEm: new Date(c.saidas.lidoEm), pagamentos: c.saidas.pagamentos });
        item.resumo = r.resumo;
        item.temPlanilha = true;
        return;
      }
    }
  }

  /** Item que só existe se houve: ou chegou arquivo, ou alguém disse que não teve. */
  private exigirAlgoOuNaoTeve(item: ItemNaTela, frase: string): void {
    if (item.naoTeve) return;
    if (item.vagas.some((v) => v.arquivos.length > 0)) return;
    item.pendencias.push(frase);
  }

  /** Os caixas lidos, com o saldo que a pessoa informou aqui. */
  caixasComInformado(linha: (item: number, chave?: string) => ItemDoPacote | undefined): CaixaNoPeriodo[] | null {
    const caixas = dadosDe<{ caixas: CaixaNoPeriodo[] }>(linha(10))?.caixas;
    if (!caixas) return null;
    return caixas.map((k) => {
      const informado = (linha(11, `caixa:${k.caixaId}`)?.resumo as { valor?: unknown } | null)?.valor;
      return { ...k, informado: typeof informado === 'number' ? informado : null };
    });
  }

  // -------------------------------------------------------------------------
  // Os recortes dos pagamentos: lucros, link, doações
  // -------------------------------------------------------------------------

  /** A seleção de um recorte: a escolhida, ou a que os nomes sugerem. */
  async selecao(qual: 'lucros' | 'doacoes' | 'link', cfg?: Configuracao): Promise<Selecao & { sugerida: boolean }> {
    const config = cfg ?? (await this.configuracao.obter());
    const escolhida = config[qual];
    if (escolhida) return { ...escolhida, sugerida: false };

    const regra = SUGESTAO[qual];
    const [categorias, pacoteRecente] = await Promise.all([
      this.prisma.categoriaDespesa.findMany({ select: { id: true, nome: true } }),
      this.prisma.itemDoPacote.findFirst({ where: { item: 8, chave: '' }, orderBy: { updatedAt: 'desc' } }),
    ]);
    // O plano de contas sugerido sai dos pagamentos já lidos: é onde os nomes
    // dele estão à mão sem ir ao IXC.
    const planos = new Map<number, string>();
    for (const p of dadosDe<DadosDasSaidas>(pacoteRecente ?? undefined)?.pagamentos ?? []) {
      if (p.planoDeContasId !== null) planos.set(p.planoDeContasId, p.planoDeContas);
    }
    return {
      categorias: categorias.filter((c) => regra.test(c.nome)).map((c) => c.id),
      planos: [...planos.entries()].filter(([, nome]) => regra.test(nome)).map(([id]) => id),
      fornecedores: [],
      sugerida: true,
    };
  }

  recorte(pagamentos: Pagamento[], qual: 'lucros' | 'doacoes' | 'link', cfg: Configuracao): Pagamento[] {
    const escolhida = cfg[qual];
    const regra = SUGESTAO[qual];
    return pagamentos.filter((p) => {
      if (escolhida) {
        return (
          p.categoriaIds.some((id) => escolhida.categorias.includes(id)) ||
          (p.planoDeContasId !== null && escolhida.planos.includes(p.planoDeContasId)) ||
          (p.fornecedorId !== null && escolhida.fornecedores.some((f) => f.id === p.fornecedorId))
        );
      }
      // Ninguém escolheu ainda: vale o que o nome diz.
      return p.categorias.some((c) => regra.test(c.nome)) || regra.test(p.planoDeContas);
    });
  }

  // -------------------------------------------------------------------------
  // Os comprovantes dos pagamentos
  // -------------------------------------------------------------------------

  /**
   * O papel de cada pagamento, de onde ele estiver: anexado no título do IXC
   * (lido junto com os pagamentos), fotografado no fechamento de caixa,
   * guardado nas notas da conta, o recibo assinado da diária, ou enviado
   * aqui. Montado na hora: é o que muda depois da leitura.
   */
  async comprovantes(pacoteId: string, saidas: DadosDasSaidas): Promise<Map<number, SituacaoDoComprovante>> {
    const ids = saidas.pagamentos.map((p) => p.idFnApagar);
    const movimentos = saidas.pagamentos.filter((p) => p.idMovimento !== null);

    const [contas, conferencias, enviados, marcas] = await Promise.all([
      this.prisma.contaPagar.findMany({
        where: { idFnApagarIxc: { in: ids } },
        select: {
          idFnApagarIxc: true,
          funcionarioId: true,
          competencia: true,
          origem: true,
          tipo: true,
          partes: { select: { fotos: { select: { id: true } } } },
          diaria: { select: { id: true, assinatura: { select: { assinadoEm: true } } } },
        },
      }),
      movimentos.length
        ? this.prisma.conferenciaCaixa.findMany({
            where: { idLancamentoIxc: { in: movimentos.map((p) => p.idMovimento as number) } },
            select: { caixaId: true, idLancamentoIxc: true, fotos: { select: { id: true, foto: true, diariaId: true } } },
          })
        : Promise.resolve([]),
      this.prisma.arquivoContabil.findMany({
        where: { pacoteId, item: 8, chave: { startsWith: 'titulo:' } },
        select: { id: true, chave: true, nome: true },
      }),
      this.prisma.itemDoPacote.findMany({
        where: { pacoteId, item: 8, chave: { startsWith: 'titulo:' }, naoTeve: true },
        select: { chave: true, observacao: true },
      }),
    ]);

    const mapa = new Map<number, SituacaoDoComprovante>();
    const de = (id: number) => {
      const s = mapa.get(id) ?? { comprovantes: [], semComprovante: null };
      mapa.set(id, s);
      return s;
    };

    for (const p of saidas.pagamentos) {
      for (const a of saidas.anexosIxc[String(p.idFnApagar)] ?? []) {
        de(p.idFnApagar).comprovantes.push({
          origem: 'ixc',
          id: `${a.id}:${p.idFnApagar}:${a.extensao}`,
          nome: `${a.descricao} (anexo no IXC)`,
        });
      }
    }
    for (const c of contas) {
      if (c.idFnApagarIxc === null) continue;
      for (const parte of c.partes) {
        for (const f of parte.fotos) de(c.idFnApagarIxc).comprovantes.push({ origem: 'conta', id: f.id, nome: 'Nota guardada na conta' });
      }
      if (c.diaria?.assinatura?.assinadoEm) {
        de(c.idFnApagarIxc).comprovantes.push({ origem: 'recibo', id: c.diaria.id, nome: 'Recibo assinado da diária' });
      }
    }
    /*
     * O pagamento da folha tem papel: o recibo do mês que a contabilidade
     * mandou e que o RH separou por funcionário (`Recibos da folha`). Quem
     * tem carteira assinada tem recibo; quem não tem, não — e para esse a
     * pessoa marca o motivo.
     */
    // Salário, férias e adiantamento estão no recibo; a gratificação é paga
    // por fora da folha da contabilidade, e o recibo não a comprova.
    const daFolha = contas.filter(
      (c) =>
        c.idFnApagarIxc !== null &&
        c.origem === 'FOLHA' &&
        ['SALARIO', 'FERIAS', 'ADIANTAMENTO'].includes(c.tipo) &&
        c.funcionarioId &&
        c.competencia,
    );
    if (daFolha.length > 0) {
      // O recibo mora na divisória de recibos dentro da pasta da pessoa: o
      // dono pode ser a pasta dele ou a mãe dela.
      const funcionarios = [...new Set(daFolha.map((c) => c.funcionarioId as string))];
      const recibos = await this.prisma.documentoRh.findMany({
        where: {
          tipo: TIPO_RECIBO,
          competencia: { in: [...new Set(daFolha.map((c) => c.competencia as string))] },
          OR: [
            { pasta: { funcionarioId: { in: funcionarios } } },
            { pasta: { pai: { funcionarioId: { in: funcionarios } } } },
          ],
        },
        select: {
          id: true,
          competencia: true,
          pasta: { select: { funcionarioId: true, pai: { select: { funcionarioId: true } } } },
        },
      });
      const donoDo = (r: (typeof recibos)[number]) => r.pasta.funcionarioId ?? r.pasta.pai?.funcionarioId ?? null;
      for (const c of daFolha) {
        const recibo = recibos.find((r) => r.competencia === c.competencia && donoDo(r) === c.funcionarioId);
        if (recibo) {
          de(c.idFnApagarIxc as number).comprovantes.push({
            origem: 'rh',
            id: recibo.id,
            nome: `Recibo da folha ${c.competencia!.slice(5)}/${c.competencia!.slice(0, 4)}`,
          });
        }
      }
    }

    const porMovimento = new Map(movimentos.map((p) => [p.idMovimento as number, p]));
    for (const conf of conferencias) {
      const p = porMovimento.get(conf.idLancamentoIxc);
      // O mesmo id de lançamento pode existir em outro caixa: só vale o da conta do pagamento.
      if (!p || (p.contaId !== null && conf.caixaId !== p.contaId)) continue;
      for (const f of conf.fotos) {
        if (f.foto) de(p.idFnApagar).comprovantes.push({ origem: 'caixa', id: f.id, nome: 'Foto da nota (fechamento de caixa)' });
        else if (f.diariaId && !de(p.idFnApagar).comprovantes.some((x) => x.origem === 'recibo')) {
          de(p.idFnApagar).comprovantes.push({ origem: 'recibo', id: f.diariaId, nome: 'Recibo assinado da diária' });
        }
      }
    }
    for (const a of enviados) {
      const id = Number(a.chave.slice('titulo:'.length));
      if (Number.isInteger(id)) de(id).comprovantes.push({ origem: 'pacote', id: a.id, nome: a.nome });
    }
    for (const m of marcas) {
      const id = Number(m.chave.slice('titulo:'.length));
      if (Number.isInteger(id)) de(id).semComprovante = m.observacao || 'sem comprovante';
    }
    return mapa;
  }

  /** A lista de pagamentos de um item (8, 13, 14, 18), com o comprovante de cada um. */
  async pagamentosDoItem(pacoteId: string, item: number) {
    if (![8, 13, 14, 18].includes(item)) throw new BadRequestException('Este item não tem lista de pagamentos.');
    const linha = await this.prisma.itemDoPacote.findUnique({
      where: { pacoteId_item_chave: { pacoteId, item: 8, chave: '' } },
    });
    const saidas = dadosDe<DadosDasSaidas>(linha ?? undefined);
    if (!saidas) return { pagamentos: [], lidoEm: null };
    const cfg = await this.configuracao.obter();
    const lista =
      item === 8
        ? saidas.pagamentos
        : this.recorte(saidas.pagamentos, item === 13 ? 'lucros' : item === 14 ? 'link' : 'doacoes', cfg);
    const comprovantes = await this.comprovantes(pacoteId, saidas);
    return {
      lidoEm: saidas.lidoEm,
      pagamentos: [...lista]
        .sort((a, b) => a.dia.localeCompare(b.dia) || a.fornecedor.localeCompare(b.fornecedor, 'pt-BR'))
        .map((p) => ({
          ...p,
          comprovantes: comprovantes.get(p.idFnApagar)?.comprovantes ?? [],
          semComprovante: comprovantes.get(p.idFnApagar)?.semComprovante ?? null,
        })),
    };
  }

  // -------------------------------------------------------------------------
  // Arquivos e marcas
  // -------------------------------------------------------------------------

  async enviarArquivo(
    pacoteId: string,
    dto: { item: number; chave: string; nome: string; arquivo: string },
    usuarioId?: string,
  ) {
    const pacote = await this.pacote(pacoteId);
    if (!ITENS.some((i) => i.numero === dto.item)) throw new BadRequestException('Item inexistente.');
    const { conteudo, tipo: tipoDeclarado } = lerDataUrl(dto.arquivo);
    if (conteudo.length > LIMITE_BYTES) {
      throw new BadRequestException('O arquivo passa de 15 MB. Divida em partes ou compacte.');
    }
    const nome = dto.nome.trim().slice(0, 200) || 'arquivo';
    const extensao = (/\.([a-z0-9]{1,5})$/i.exec(nome)?.[1] ?? '').toLowerCase();
    if (/^(exe|bat|cmd|js|vbs|msi|scr|ps1|sh)$/.test(extensao)) {
      throw new BadRequestException('Este tipo de arquivo não é aceito.');
    }
    const tipo =
      tipoDeclarado && tipoDeclarado !== 'application/octet-stream'
        ? tipoDeclarado
        : (TIPO_POR_EXTENSAO[extensao] ?? 'application/octet-stream');

    // O OFX é conferido na entrada: arquivo errado aqui só se descobriria na
    // conciliação, depois de alguém achar que estava tudo enviado.
    if (dto.chave.endsWith(':ofx')) {
      let extrato;
      try {
        extrato = lerOfx(conteudo);
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : 'Este arquivo não é um OFX.');
      }
      const de = diaIso(pacote.de);
      const ate = diaIso(pacote.ate);
      const noPeriodo = extrato.lancamentos.filter((l) => l.dia >= de && l.dia <= ate);
      if (extrato.lancamentos.length > 0 && noPeriodo.length === 0) {
        throw new BadRequestException(
          `Este OFX não tem nenhum lançamento entre ${diaBr(de)} e ${diaBr(ate)} ` +
            `(ele vai de ${diaBr(extrato.lancamentos[0].dia)} a ${diaBr(extrato.lancamentos[extrato.lancamentos.length - 1].dia)}).`,
        );
      }
    }

    // Contrato de empréstimo vale para os meses seguintes: não fica preso a
    // este pacote.
    const permanente = dto.item === 3;
    const vaga = dto.chave;
    const unico = !permanente && (vaga.endsWith(':pdf') || vaga.endsWith(':excel') || vaga.endsWith(':ofx') || vaga.endsWith(':fatura'));
    if (unico) {
      // Vaga de um arquivo só: o novo substitui o anterior.
      await this.prisma.arquivoContabil.deleteMany({ where: { pacoteId, item: dto.item, chave: vaga } });
    }

    const criado = await this.prisma.arquivoContabil.create({
      data: {
        pacoteId: permanente ? null : pacoteId,
        item: dto.item,
        chave: permanente ? 'contrato' : vaga,
        nome,
        tipo,
        tamanho: conteudo.length,
        conteudo: new Uint8Array(conteudo),
        vigenteDesde: permanente ? pacote.de : null,
        criadoPor: usuarioId ?? null,
      },
      select: { id: true, nome: true, tamanho: true, createdAt: true },
    });

    // Quem envia o arquivo não está mais dizendo que ele não existe.
    await this.prisma.itemDoPacote.updateMany({
      where: { pacoteId, item: dto.item, chave: { in: permanente ? ['', 'contrato'] : [vaga, ''] }, naoTeve: true },
      data: { naoTeve: false },
    });

    if (vaga.endsWith(':ofx')) this.leitor.iniciar(pacoteId, ['conciliacao']);
    return criado;
  }

  async arquivo(id: string) {
    const a = await this.prisma.arquivoContabil.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Este arquivo não existe mais.');
    return a;
  }

  async apagarArquivo(id: string): Promise<void> {
    const a = await this.arquivo(id);
    await this.prisma.arquivoContabil.delete({ where: { id } });
    if (a.pacoteId && a.chave.endsWith(':ofx')) this.leitor.iniciar(a.pacoteId, ['conciliacao']);
  }

  /** Contrato quitado: deixa de ir nos pacotes depois deste dia. */
  async encerrarContrato(id: string, em: string): Promise<void> {
    const a = await this.arquivo(id);
    if (a.item !== 3) throw new BadRequestException('Só contrato se encerra.');
    await this.prisma.arquivoContabil.update({ where: { id }, data: { encerradoEm: dataDoDia(em) } });
  }

  /** Os contratos que valiam no período: enviados até o fim dele e não encerrados antes do começo. */
  async contratosVigentes(de: string, ate: string): Promise<ArquivoNaTela[]> {
    const lista = await this.prisma.arquivoContabil.findMany({
      where: {
        item: 3,
        pacoteId: null,
        OR: [{ vigenteDesde: null }, { vigenteDesde: { lte: dataDoDia(ate) } }],
        AND: [{ OR: [{ encerradoEm: null }, { encerradoEm: { gte: dataDoDia(de) } }] }],
      },
      select: { id: true, nome: true, tamanho: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return lista;
  }

  /**
   * Marca (ou desmarca) que não teve / não tem. Com `valor`, guarda o saldo
   * contado de um caixa (item 11).
   */
  async marcar(
    pacoteId: string,
    dto: { item: number; chave?: string; naoTeve?: boolean; observacao?: string | null; valor?: number | null },
    usuarioId?: string,
  ): Promise<void> {
    await this.pacote(pacoteId);
    const chave = dto.chave ?? '';
    const resumo =
      dto.valor === undefined ? undefined : dto.valor === null ? Prisma.JsonNull : ({ valor: Math.round(dto.valor * 100) / 100 } as Prisma.InputJsonValue);
    await this.prisma.itemDoPacote.upsert({
      where: { pacoteId_item_chave: { pacoteId, item: dto.item, chave } },
      create: {
        pacoteId,
        item: dto.item,
        chave,
        naoTeve: dto.naoTeve ?? false,
        observacao: dto.observacao?.trim() || null,
        ...(resumo !== undefined ? { resumo } : {}),
        marcadoPor: usuarioId ?? null,
      },
      update: {
        ...(dto.naoTeve !== undefined ? { naoTeve: dto.naoTeve } : {}),
        ...(dto.observacao !== undefined ? { observacao: dto.observacao?.trim() || null } : {}),
        ...(resumo !== undefined ? { resumo } : {}),
        marcadoPor: usuarioId ?? null,
      },
    });
  }

  /**
   * Marca vários pagamentos de uma vez como "não tem comprovante", com o mesmo
   * motivo — a folha do mês são cem pagamentos, e cem cliques não. `motivo`
   * nulo desfaz.
   */
  async marcarVarios(
    pacoteId: string,
    titulos: number[],
    motivo: string | null,
    usuarioId?: string,
  ): Promise<{ marcados: number }> {
    await this.pacote(pacoteId);
    const chaves = [...new Set(titulos)].map((t) => `titulo:${t}`);
    await this.prisma.$transaction(
      chaves.map((chave) =>
        this.prisma.itemDoPacote.upsert({
          where: { pacoteId_item_chave: { pacoteId, item: 8, chave } },
          create: { pacoteId, item: 8, chave, naoTeve: motivo !== null, observacao: motivo, marcadoPor: usuarioId ?? null },
          update: { naoTeve: motivo !== null, observacao: motivo, marcadoPor: usuarioId ?? null },
        }),
      ),
    );
    return { marcados: chaves.length };
  }

  async marcarBaixado(pacoteId: string): Promise<void> {
    await this.prisma.pacoteContabil.update({ where: { id: pacoteId }, data: { baixadoEm: new Date() } });
  }
}

function rotuloDaConta(conta: ContaDoPacote): string {
  const detalhe = [conta.agencia && `ag. ${conta.agencia}`, conta.numero && `c/c ${conta.numero}`].filter(Boolean).join(' ');
  return detalhe ? `${conta.nome} (${detalhe})` : conta.nome;
}

export type { Comprovante };
