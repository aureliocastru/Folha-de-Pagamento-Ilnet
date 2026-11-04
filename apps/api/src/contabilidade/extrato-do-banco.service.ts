import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModobankClient } from '../modobank/modobank.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  abaDoExtrato,
  brl,
  conferirComOBanco,
  contraparteDe,
  detalheDoQueNaoFecha,
  diaBr,
  diaEHoraEmBrasilia,
  entraNoExtrato,
  fecharComOBanco,
  lerTransacao,
  ofxDoExtrato,
  pdfDoExtrato,
  resumoDoConsolidado,
  saidaDesfeita,
  type ExtratoDoBanco,
  type FechamentoComOBanco,
  type LancamentoDoExtrato,
  type ResumoDoBanco,
} from './extrato-do-banco';
import type { ContaDoPacote } from './leitor.service';
import { montarPlanilha } from './planilha';

/** Quem "enviou" o arquivo que o sistema montou: é o que o distingue do enviado à mão. */
export const ENVIADO_PELO_BANCO = 'banco:modobank';

/** O que ficou registrado da última montagem — serve para conferir de fora. */
export interface DiagnosticoDoExtrato {
  geradoEm: string;
  /** Quantos o banco disse que existem, e quantos vieram. */
  totalDoBanco: number | null;
  recebidos: number;
  noExtrato: number;
  /** Situação → quantos ficaram fora por ela. */
  fora: Record<string, number>;
  /** Os campos que o banco mandou num lançamento (só os nomes). */
  campos: string[];
  semNome: number;
  porSituacao: FechamentoComOBanco['porSituacao'];
  /** Situações tiradas porque, sem elas, o extrato fecha com o banco. */
  tiradasPelaSoma: string[];
  diasQueNaoBatem: FechamentoComOBanco['diasQueNaoBatem'];
  /** Saídas que o detalhe mostrou desfeitas (devolvidas, recusadas). */
  desfeitas: Array<{ dia: string; valor: number; id: string; contraparte: string | null }>;
  detalhesLidos: number;
  /** Não fechando: as saídas dos dias ruins, cruas, como o banco mandou. */
  suspeitos: Array<{ lista: Record<string, unknown> | null; detalhe: Record<string, unknown> | null }>;
  conferencia: string;
  fechou: boolean | null;
}

@Injectable()
export class ExtratoDoBancoService {
  private readonly logger = new Logger(ExtratoDoBancoService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly banco?: ModobankClient,
  ) {}

  /** A API do banco está ligada no servidor. */
  get ligado(): boolean {
    return !!this.banco?.configurado;
  }

  /** A conta do IXC que é a da ModoBank: a de pagamento da configuração. */
  async contaDoBanco(): Promise<number> {
    const cfg = await this.prisma.configuracaoFinanceira.findUnique({
      where: { id: 1 },
      select: { contaPagamentoId: true },
    });
    return cfg?.contaPagamentoId ?? 18;
  }

  /**
   * Monta o PDF, o Excel e o OFX da conta e guarda nas vagas dela no item 1.
   *
   * Arquivo enviado à mão fica: quem baixou do portal e mandou escolheu aquele.
   * O montado antes por aqui é trocado pelo de agora. Devolve os avisos para a
   * tela e o diagnóstico; falha do banco vira aviso, e não erro do item — a
   * conta continua podendo receber o extrato à mão.
   */
  async montarEGuardar(
    pacoteId: string,
    de: string,
    ate: string,
    conta: ContaDoPacote,
  ): Promise<{ avisos: string[]; diagnostico: DiagnosticoDoExtrato | null }> {
    if (!this.banco?.configurado) return { avisos: [], diagnostico: null };
    const avisos: string[] = [];

    let crus: { itens: Array<Record<string, unknown>>; total: number | null };
    try {
      crus = await this.banco.transacoes(de, ate);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Extrato da ModoBank ${de} a ${ate}: ${msg}`);
      return {
        avisos: [`ModoBank: não deu para buscar o extrato pela API (${msg}). Envie o arquivo à mão.`],
        diagnostico: null,
      };
    }

    const todos: LancamentoDoExtrato[] = [];
    let ilegiveis = 0;
    for (const bruto of crus.itens) {
      const l = lerTransacao(bruto);
      if (!l) {
        ilegiveis++;
        continue;
      }
      // O banco pode devolver um pouco além das pontas: vale o dia de Brasília.
      if (l.dia < de || l.dia > ate) continue;
      todos.push(l);
    }
    if (ilegiveis > 0) avisos.push(`ModoBank: ${ilegiveis} lançamento(s) vieram sem data ou valor legível.`);
    if (crus.total !== null && crus.itens.length < crus.total) {
      avisos.push(`ModoBank: o banco disse ${crus.total} lançamentos e vieram ${crus.itens.length}.`);
    }

    const resumo = await this.resumo(de, ate).catch((e: unknown) => {
      avisos.push(
        `ModoBank: não deu para ler o saldo do banco para conferir (${e instanceof Error ? e.message : String(e)}).`,
      );
      return null;
    });

    // O detalhe de cada um: o nome de quem pagou/recebeu, e se a saída voltou.
    const detalhes = await this.lerDetalhes(todos.filter((l) => entraNoExtrato(l.situacao)));
    const desfeitas = todos.filter((l) => saidaDesfeita(l, detalhes.get(l.id) ?? null));
    if (desfeitas.length > 0) {
      avisos.push(
        `ModoBank: ${desfeitas.length} saída(s) que o banco desfez ficaram fora do extrato — ` +
          desfeitas
            .map((l) => `${diaBr(l.dia)} ${brl(-l.valor)}${l.contraparte ? ` (${l.contraparte})` : ''}`)
            .join('; ') +
          '. Confira se no IXC elas também não estão como pagas.',
      );
    }
    const semDesfeitas = todos.filter((l) => !desfeitas.includes(l));

    const fechamento = fecharComOBanco(semDesfeitas, resumo);
    const lancamentos = fechamento.lancamentos.sort((a, b) => (a.dia + a.hora).localeCompare(b.dia + b.hora));
    const ficaram = new Set(lancamentos);
    const fora: Record<string, number> = {};
    for (const l of todos) {
      if (ficaram.has(l)) continue;
      const motivo = desfeitas.includes(l) ? `${l.situacao} desfeita` : l.situacao;
      fora[motivo] = (fora[motivo] ?? 0) + 1;
    }

    const conferido = conferirComOBanco(lancamentos, resumo);
    if (conferido.aviso) avisos.push(`${conferido.aviso} ${detalheDoQueNaoFecha(fechamento)}`);

    /*
     * Não fechando, as saídas dos dias que não batem ficam guardadas como o
     * banco as mandou (lista e detalhe): é por elas que se descobre o próximo
     * jeito de o banco desfazer um pagamento sem dizer na lista.
     */
    const diasRuins = new Set(fechamento.diasQueNaoBatem.map((d) => d.dia));
    const cruDoId = new Map(crus.itens.map((c) => [String(c.id ?? c.endToEndId ?? ''), c]));
    const suspeitos = lancamentos
      .filter((l) => diasRuins.has(l.dia) && l.valor < 0 && l.tipo !== 'Débito autorizado')
      .slice(0, 40)
      .map((l) => ({ lista: cruDoId.get(l.id) ?? null, detalhe: detalhes.get(l.id) ?? null }));
    if (ate >= hoje()) {
      avisos.push('ModoBank: o período ainda não acabou — o extrato vai até agora e é refeito a cada leitura.');
    }

    const extrato: ExtratoDoBanco = {
      conta: { nome: conta.nome, banco: conta.banco, agencia: conta.agencia, numero: conta.numero },
      de,
      ate,
      geradoEm: new Date(),
      lancamentos,
      saldoInicial: resumo?.saldoInicial ?? null,
      saldoFinal: resumo?.saldoFinal ?? null,
      conferencia: conferido.frase,
    };

    const nomeBase = `Extrato ${conta.nome} ${de} a ${ate}`.replace(/[\\/:*?"<>|]+/g, '-');
    const arquivos: Array<{ chave: string; nome: string; tipo: string; conteudo: Buffer }> = [
      {
        chave: `conta:${conta.id}:pdf`,
        nome: `${nomeBase}.pdf`,
        tipo: 'application/pdf',
        conteudo: await pdfDoExtrato(extrato),
      },
      {
        chave: `conta:${conta.id}:excel`,
        nome: `${nomeBase}.xlsx`,
        tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        conteudo: await montarPlanilha([abaDoExtrato(extrato)]),
      },
      {
        chave: `conta:${conta.id}:ofx`,
        nome: `${nomeBase}.ofx`,
        tipo: 'application/x-ofx',
        conteudo: ofxDoExtrato(extrato),
      },
    ];
    await this.guardar(pacoteId, arquivos);

    const diagnostico: DiagnosticoDoExtrato = {
      geradoEm: extrato.geradoEm.toISOString(),
      totalDoBanco: crus.total,
      recebidos: crus.itens.length,
      noExtrato: lancamentos.length,
      fora,
      campos: Object.keys(crus.itens[0] ?? {}).sort(),
      semNome: lancamentos.filter((l) => !l.contraparte).length,
      porSituacao: fechamento.porSituacao,
      tiradasPelaSoma: fechamento.tiradasPelaSoma,
      diasQueNaoBatem: fechamento.diasQueNaoBatem,
      desfeitas: desfeitas.map((l) => ({ dia: l.dia, valor: l.valor, id: l.id, contraparte: l.contraparte })),
      detalhesLidos: detalhes.size,
      suspeitos,
      conferencia: conferido.frase,
      fechou: resumo && resumo.saldoInicial !== null && resumo.saldoFinal !== null ? !conferido.aviso : null,
    };
    this.logger.log(
      `Extrato da ModoBank ${de} a ${ate}: ${lancamentos.length} lançamentos ` +
        `(${crus.itens.length} recebidos, fora ${JSON.stringify(fora)}); ${conferido.frase}`,
    );
    return { avisos, diagnostico };
  }

  /**
   * O detalhe de cada lançamento: quem pagou ou recebeu (a lista não traz), e
   * se a saída voltou.
   *
   * As saídas primeiro — são poucas (224 Pix em out/2026) e é nelas que mora o
   * dinheiro que pode ter voltado; depois as entradas, que são o nome do
   * cliente. O débito de R$ 0,22 da ModoBank, um por Pix recebido, fica de
   * fora: é sempre o mesmo, e seriam outras cinco mil idas ao banco. Seis de
   * cada vez; para no primeiro "devagar" do banco ou se os três primeiros
   * falharem — o nome enfeita o extrato, mas não pode derrubar a leitura.
   */
  private async lerDetalhes(
    lancamentos: LancamentoDoExtrato[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const detalhes = new Map<string, Record<string, unknown>>();
    if (!this.banco) return detalhes;
    const banco = this.banco;
    const pedir = [
      ...lancamentos.filter((l) => l.valor < 0 && l.tipo !== 'Débito autorizado'),
      ...lancamentos.filter((l) => l.valor > 0 && !l.contraparte),
    ].slice(0, 8000);

    let falhas = 0;
    let parar = false;
    let proximo = 0;
    const trabalhar = async () => {
      while (!parar && proximo < pedir.length) {
        const l = pedir[proximo++];
        try {
          const d = await banco.detalheDaTransacao(l.id);
          if (!d) continue;
          detalhes.set(l.id, d);
          const outro = contraparteDe(d, l.valor > 0);
          if (outro.nome && !l.contraparte) {
            l.contraparte = outro.nome;
            l.documento = outro.documento;
          }
        } catch (e) {
          falhas++;
          const msg = e instanceof Error ? e.message : String(e);
          if (/429|limite|too many/i.test(msg) || (detalhes.size === 0 && falhas >= 3)) {
            this.logger.warn(`Extrato da ModoBank: parei de pedir detalhes (${msg}).`);
            parar = true;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, trabalhar));
    return detalhes;
  }

  /** O diagnóstico da última montagem do extrato do pacote (para conferir de fora). */
  async diagnostico(pacoteId: string): Promise<unknown> {
    const linha = await this.prisma.itemDoPacote.findUnique({
      where: { pacoteId_item_chave: { pacoteId, item: 1, chave: '' } },
      select: { dados: true },
    });
    const dados = linha?.dados as { extratoDoBanco?: unknown } | null;
    return dados?.extratoDoBanco ?? null;
  }

  /** O detalhe cru de um lançamento, como o banco o devolve. Só leitura. */
  async detalheCru(id: string): Promise<Record<string, unknown> | null> {
    if (!this.banco?.configurado) return null;
    return this.banco.detalheDaTransacao(id);
  }

  /**
   * O resumo do banco para o período — o que confere o extrato. Por dia até
   * 60 dias; mês a mês para meses inteiros. Período que inclui hoje não tem
   * resumo: o banco só fecha dia passado.
   */
  private async resumo(de: string, ate: string): Promise<ResumoDoBanco | null> {
    if (!this.banco || ate >= hoje()) return null;
    const dias = (Date.parse(ate) - Date.parse(de)) / 86_400_000 + 1;
    if (dias <= 60) {
      return resumoDoConsolidado(
        await this.banco.extratoConsolidado({ groupBy: 'DAY', initialDate: de, finalDate: ate }),
      );
    }
    const mesInteiro = de.endsWith('-01') && ultimoDiaDoMes(ate) === ate;
    if (!mesInteiro) return null;
    return resumoDoConsolidado(
      await this.banco.extratoConsolidado({
        groupBy: 'MONTH',
        initialDate: de.slice(0, 7),
        finalDate: ate.slice(0, 7),
      }),
    );
  }

  private async guardar(
    pacoteId: string,
    arquivos: Array<{ chave: string; nome: string; tipo: string; conteudo: Buffer }>,
  ): Promise<void> {
    for (const a of arquivos) {
      const existentes = await this.prisma.arquivoContabil.findMany({
        where: { pacoteId, item: 1, chave: a.chave },
        select: { id: true, criadoPor: true },
      });
      if (existentes.some((x) => x.criadoPor !== ENVIADO_PELO_BANCO)) continue;
      await this.prisma.$transaction([
        this.prisma.arquivoContabil.deleteMany({
          where: { pacoteId, item: 1, chave: a.chave, criadoPor: ENVIADO_PELO_BANCO },
        }),
        this.prisma.arquivoContabil.create({
          data: {
            pacoteId,
            item: 1,
            chave: a.chave,
            nome: a.nome,
            tipo: a.tipo,
            tamanho: a.conteudo.length,
            conteudo: new Uint8Array(a.conteudo),
            criadoPor: ENVIADO_PELO_BANCO,
          },
        }),
        // Com o arquivo na vaga, o "o banco não fornece" deixa de valer.
        this.prisma.itemDoPacote.updateMany({
          where: { pacoteId, item: 1, chave: a.chave, naoTeve: true },
          data: { naoTeve: false },
        }),
      ]);
    }
  }
}

function hoje(): string {
  return diaEHoraEmBrasilia(new Date().toISOString())!.dia;
}

function ultimoDiaDoMes(dia: string): string {
  const [a, m] = dia.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${dia.slice(0, 7)}-${String(ultimo).padStart(2, '0')}`;
}
