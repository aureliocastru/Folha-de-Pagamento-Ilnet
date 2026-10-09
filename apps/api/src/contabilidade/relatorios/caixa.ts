import { centavos, diaBr } from '../ixc-leitura';
import { moeda, quantidade, reais, soma, type Relatorio } from './relatorio';

/**
 * 10 e 11 — O caixa físico: o dinheiro em mãos.
 *
 * Não é leitura nova do IXC: é o fechamento de caixa daqui
 * (`FechamentoCaixaService.extrato`), que já sabe ler os lançamentos do caixa
 * no IXC, já guarda o que foi conferido e a foto de cada nota, e já encadeia o
 * saldo de um fechamento para o outro. Repetir aquela conta aqui seria ter
 * dois saldos para a mesma gaveta.
 *
 * O saldo do último dia, por ordem de confiança:
 *
 * 1. o fechamento que termina naquele dia, com a gaveta contada;
 * 2. o mesmo fechamento sem contagem — o calculado que ele assinou;
 * 3. sem fechamento no dia, o calculado pelo extrato: o último fechamento
 *    antes do dia mais o que entrou e saiu até o fim dele;
 * 4. nada disso (o caixa nunca foi fechado): o valor que a pessoa informar
 *    aqui, contado.
 */

/** Um lançamento do caixa, como o extrato do fechamento o devolve. */
export interface LancamentoDoCaixa {
  id: number;
  data: Date | string;
  valor: number;
  historico: string;
  tipo: 'ENTRADA' | 'SAIDA';
  conferido: boolean;
  qtdNotas: number;
  observacao: string | null;
  foraDaGaveta: boolean;
  motivoForaDaGaveta: string | null;
}

export interface FechamentoNoPeriodo {
  de: Date | string;
  ate: Date | string;
  saldoInicial: number;
  saldoFinal: number;
  saldoContado: number | null;
  totalNaRua: number;
  totalEntradas: number;
  totalSaidas: number;
  conferidos: number;
  lancamentos: number;
  fechadoPor: string | null;
}

export interface CaixaNoPeriodo {
  caixaId: number;
  nome: string;
  lancamentos: LancamentoDoCaixa[];
  saldoInicial: number | null;
  /** De que dia é o fechamento de onde o saldo inicial partiu. */
  fechadoAte: string | null;
  saldoCalculadoNoFim: number | null;
  fechamentos: FechamentoNoPeriodo[];
  /** O valor que a pessoa informou como contado no último dia. */
  informado: number | null;
}

/** "AAAA-MM-DD" de uma data do Prisma (`@db.Date` ou instante). */
export function diaDe(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export interface SaldoDoCaixa {
  valor: number | null;
  como: string;
  naRua: number | null;
}

export function saldoNoDia(caixa: CaixaNoPeriodo, dia: string): SaldoDoCaixa {
  const doDia = caixa.fechamentos.find((f) => diaDe(f.ate) === dia);
  if (doDia && doDia.saldoContado !== null) {
    return { valor: doDia.saldoContado, como: `Contado no fechamento de ${diaBr(dia)}`, naRua: doDia.totalNaRua };
  }
  if (doDia) {
    return { valor: doDia.saldoFinal, como: `Calculado no fechamento de ${diaBr(dia)} (sem contagem)`, naRua: doDia.totalNaRua };
  }
  if (caixa.informado !== null) {
    return { valor: caixa.informado, como: 'Informado aqui', naRua: null };
  }
  if (caixa.saldoCalculadoNoFim !== null) {
    return {
      valor: caixa.saldoCalculadoNoFim,
      como: `Calculado: fechamento de ${diaBr(caixa.fechadoAte)} + o que entrou e saiu até ${diaBr(dia)}`,
      naRua: null,
    };
  }
  return { valor: null, como: 'Sem fechamento: informe o valor contado', naRua: null };
}

export function relatorioDoCaixaFisico(opcoes: {
  de: string;
  ate: string;
  caixas: CaixaNoPeriodo[];
}): Relatorio {
  const { de, ate } = opcoes;
  const avisos: string[] = [];

  const abas: Relatorio['abas'] = opcoes.caixas.map((c) => {
    const entradas = soma(c.lancamentos.filter((l) => l.tipo === 'ENTRADA'), (l) => l.valor);
    const saidas = soma(c.lancamentos.filter((l) => l.tipo === 'SAIDA'), (l) => l.valor);
    const saidasSemConferir = c.lancamentos.filter((l) => l.tipo === 'SAIDA' && !l.conferido);
    const saidasSemNota = c.lancamentos.filter((l) => l.tipo === 'SAIDA' && l.qtdNotas === 0);
    if (saidasSemConferir.length > 0) {
      avisos.push(`${c.nome}: ${saidasSemConferir.length} saídas ainda não conferidas no Fechamento de Caixa.`);
    }
    const saldo = saldoNoDia(c, ate);
    const contado = c.fechamentos.find((f) => diaDe(f.ate) === ate)?.saldoContado ?? null;

    return {
      nome: c.nome,
      cabecalho: [
        `Conciliação do caixa físico — ${c.nome} — ${diaBr(de)} a ${diaBr(ate)}`,
        c.saldoInicial !== null
          ? `Saldo de partida: ${reais(c.saldoInicial)} (fechamento de ${diaBr(c.fechadoAte)}).`
          : 'Este caixa não tinha fechamento antes do período.',
        `Entradas: ${reais(entradas)}. Saídas: ${reais(saidas)}.`,
        saldo.valor !== null
          ? `Saldo em ${diaBr(ate)}: ${reais(saldo.valor)} — ${saldo.como}.`
          : `Saldo em ${diaBr(ate)}: sem fechamento.`,
        ...(contado !== null && c.saldoCalculadoNoFim !== null
          ? [`Diferença entre o contado e o calculado: ${reais(centavos(contado - c.saldoCalculadoNoFim))}.`]
          : []),
        `${c.lancamentos.filter((l) => l.conferido).length} de ${c.lancamentos.length} lançamentos conferidos; ` +
          `${saidasSemNota.length} saídas sem foto de nota.`,
      ],
      colunas: [
        { titulo: 'Data', tipo: 'data' },
        { titulo: 'Histórico', tipo: 'texto', largura: 50 },
        { titulo: 'Entrada', tipo: 'moeda' },
        { titulo: 'Saída', tipo: 'moeda' },
        { titulo: 'Conferido', tipo: 'texto', largura: 10 },
        { titulo: 'Fotos da nota', tipo: 'inteiro', largura: 12 },
        { titulo: 'Observação', tipo: 'texto', largura: 36 },
        { titulo: 'Lançamento no IXC', tipo: 'inteiro', largura: 16 },
      ],
      linhas: [...c.lancamentos]
        .sort((a, b) => diaDe(a.data).localeCompare(diaDe(b.data)) || a.id - b.id)
        .map((l) => [
          diaDe(l.data),
          l.historico,
          l.tipo === 'ENTRADA' ? l.valor : null,
          l.tipo === 'SAIDA' ? l.valor : null,
          l.conferido ? 'Sim' : 'Não',
          l.tipo === 'SAIDA' ? l.qtdNotas : null,
          [l.observacao, l.foraDaGaveta ? `Fora da gaveta: ${l.motivoForaDaGaveta ?? ''}` : null]
            .filter(Boolean)
            .join(' · '),
          l.id,
        ]),
      totais: ['Total', '', entradas, saidas, '', null, '', null],
    };
  });

  const fechamentos = opcoes.caixas.flatMap((c) => c.fechamentos.map((f) => ({ caixa: c.nome, ...f })));
  if (fechamentos.length > 0) {
    abas.push({
      nome: 'Fechamentos',
      cabecalho: [`Fechamentos de caixa que tocam o período — ${diaBr(de)} a ${diaBr(ate)}`],
      colunas: [
        { titulo: 'Caixa', tipo: 'texto', largura: 22 },
        { titulo: 'De', tipo: 'data' },
        { titulo: 'Até', tipo: 'data' },
        { titulo: 'Saldo inicial', tipo: 'moeda' },
        { titulo: 'Entradas', tipo: 'moeda' },
        { titulo: 'Saídas', tipo: 'moeda' },
        { titulo: 'Calculado', tipo: 'moeda' },
        { titulo: 'Contado', tipo: 'moeda' },
        { titulo: 'Diferença', tipo: 'moeda' },
        { titulo: 'Com pessoas (na rua)', tipo: 'moeda', largura: 18 },
        { titulo: 'Conferidos', tipo: 'texto', largura: 12 },
      ],
      linhas: fechamentos.map((f) => [
        f.caixa,
        diaDe(f.de),
        diaDe(f.ate),
        f.saldoInicial,
        f.totalEntradas,
        f.totalSaidas,
        f.saldoFinal,
        f.saldoContado,
        f.saldoContado !== null ? centavos(f.saldoContado - f.saldoFinal) : null,
        f.totalNaRua,
        `${f.conferidos} de ${f.lancamentos}`,
      ]),
    });
  }

  if (abas.length === 0) {
    abas.push({
      nome: 'Caixa físico',
      cabecalho: [`Nenhum caixa de dinheiro teve movimento entre ${diaBr(de)} e ${diaBr(ate)}.`],
      colunas: [{ titulo: '', tipo: 'texto' }],
      linhas: [],
    });
  }

  const lancamentos = opcoes.caixas.flatMap((c) => c.lancamentos);
  return {
    arquivo: `Conciliacao do caixa fisico ${diaBr(de).replace(/\//g, '-')} a ${diaBr(ate).replace(/\//g, '-')}`,
    resumo: [
      moeda('Entradas', soma(lancamentos.filter((l) => l.tipo === 'ENTRADA'), (l) => l.valor)),
      moeda('Saídas', soma(lancamentos.filter((l) => l.tipo === 'SAIDA'), (l) => l.valor)),
      quantidade('Lançamentos', lancamentos.length),
      quantidade('Conferidos', lancamentos.filter((l) => l.conferido).length),
    ],
    avisos,
    abas,
  };
}

export function relatorioDoSaldoDoCaixa(opcoes: { ate: string; caixas: CaixaNoPeriodo[] }): Relatorio {
  const { ate } = opcoes;
  const saldos = opcoes.caixas.map((c) => ({ caixa: c, saldo: saldoNoDia(c, ate) }));
  const conhecidos = saldos.filter((s) => s.saldo.valor !== null);
  const total = soma(conhecidos, (s) => s.saldo.valor ?? 0);

  return {
    arquivo: `Saldo do caixa fisico ${diaBr(ate).replace(/\//g, '-')}`,
    resumo: [
      moeda(`Em caixa em ${diaBr(ate)}`, total, true),
      ...saldos.map((s) =>
        s.saldo.valor !== null
          ? moeda(s.caixa.nome, s.saldo.valor)
          : { rotulo: s.caixa.nome, valor: 'falta o valor', tipo: 'texto' as const },
      ),
    ],
    avisos: saldos
      .filter((s) => s.saldo.valor === null)
      .map((s) => `${s.caixa.nome} nunca foi fechado: informe quanto havia nele em ${diaBr(ate)}.`),
    abas: [
      {
        nome: 'Saldo do caixa',
        cabecalho: [`Saldo do caixa físico em ${diaBr(ate)}`],
        colunas: [
          { titulo: 'Caixa', tipo: 'texto', largura: 26 },
          { titulo: 'Saldo', tipo: 'moeda', largura: 16 },
          { titulo: 'De onde veio', tipo: 'texto', largura: 62 },
          { titulo: 'Com pessoas (na rua)', tipo: 'moeda', largura: 18 },
        ],
        linhas: saldos.map((s) => [s.caixa.nome, s.saldo.valor, s.saldo.como, s.saldo.naRua]),
        totais: ['Total', total, '', null],
      },
    ],
  };
}
