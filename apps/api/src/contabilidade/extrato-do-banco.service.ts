import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModobankClient } from '../modobank/modobank.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  abaDoExtrato,
  conferirComOBanco,
  contraparteDe,
  diaEHoraEmBrasilia,
  entraNoExtrato,
  lerTransacao,
  ofxDoExtrato,
  pdfDoExtrato,
  resumoDoConsolidado,
  type ExtratoDoBanco,
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

    const fora: Record<string, number> = {};
    const lancamentos: LancamentoDoExtrato[] = [];
    let ilegiveis = 0;
    for (const bruto of crus.itens) {
      const l = lerTransacao(bruto);
      if (!l) {
        ilegiveis++;
        continue;
      }
      if (!entraNoExtrato(l.situacao)) {
        fora[l.situacao] = (fora[l.situacao] ?? 0) + 1;
        continue;
      }
      // O banco pode devolver um pouco além das pontas: vale o dia de Brasília.
      if (l.dia < de || l.dia > ate) continue;
      lancamentos.push(l);
    }
    lancamentos.sort((a, b) => (a.dia + a.hora).localeCompare(b.dia + b.hora));
    if (ilegiveis > 0) avisos.push(`ModoBank: ${ilegiveis} lançamento(s) vieram sem data ou valor legível.`);
    if (crus.total !== null && crus.itens.length < crus.total) {
      avisos.push(`ModoBank: o banco disse ${crus.total} lançamentos e vieram ${crus.itens.length}.`);
    }

    await this.completarNomes(lancamentos, crus.itens);

    const resumo = await this.resumo(de, ate).catch((e: unknown) => {
      avisos.push(
        `ModoBank: não deu para ler o saldo do banco para conferir (${e instanceof Error ? e.message : String(e)}).`,
      );
      return null;
    });
    const conferido = conferirComOBanco(lancamentos, resumo);
    if (conferido.aviso) avisos.push(conferido.aviso);
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
   * O nome de quem pagou ou recebeu, para o lançamento que veio sem ele.
   *
   * Um por um, no detalhe — a lista não traz. Quatro de cada vez, e para no
   * primeiro "devagar" do banco ou se os três primeiros falharem: o nome
   * enfeita o extrato, mas não pode derrubar a leitura do mês.
   */
  private async completarNomes(
    lancamentos: LancamentoDoExtrato[],
    crus: Array<Record<string, unknown>>,
  ): Promise<void> {
    if (!this.banco) return;
    const banco = this.banco;
    const semNome = lancamentos.filter((l) => !l.contraparte).slice(0, 3000);
    if (semNome.length === 0) return;
    const idDoBanco = new Map(crus.map((c) => [String(c.id ?? c.endToEndId ?? ''), c]));

    let falhas = 0;
    let acertos = 0;
    let parar = false;
    let proximo = 0;
    const trabalhar = async () => {
      while (!parar && proximo < semNome.length) {
        const l = semNome[proximo++];
        const cru = idDoBanco.get(l.id);
        const id = String(cru?.id ?? l.id);
        try {
          const d = await banco.detalheDaTransacao(id);
          if (!d) continue;
          const outro = contraparteDe(d, l.valor > 0);
          if (outro.nome) {
            l.contraparte = outro.nome;
            l.documento = outro.documento;
            acertos++;
          }
        } catch (e) {
          falhas++;
          const msg = e instanceof Error ? e.message : String(e);
          if (/429|limite|too many/i.test(msg) || (acertos === 0 && falhas >= 3)) {
            this.logger.warn(`Extrato da ModoBank: parei de pedir nomes (${msg}).`);
            parar = true;
          }
        }
      }
    };
    await Promise.all([trabalhar(), trabalhar(), trabalhar(), trabalhar()]);
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
