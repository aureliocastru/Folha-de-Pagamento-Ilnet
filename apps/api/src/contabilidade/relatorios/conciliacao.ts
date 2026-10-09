import { centavos, diaBr, diaDoIxc, diasEntre, idDoIxc, numero, texto } from '../ixc-leitura';
import type { ExtratoOfx, LancamentoDoBanco } from '../ofx';
import type { Aba } from '../planilha';
import { moeda, quantidade, reais, soma, type Relatorio } from './relatorio';

/**
 * 09 — Conciliação bancária: o extrato do banco (o OFX que veio no item 1)
 * comparado, linha a linha, com o que o IXC registrou naquela conta.
 *
 * O lado do IXC é o razão da conta (`fn_movim_finan` com `id_conta` = o
 * planejamento dela): débito é dinheiro entrando, crédito é saindo — a conta
 * do banco é de ativo. Nesta base ele espelha o extrato de perto: "Rec.
 * Títulos" do dia (a liquidação da cobrança), "Tarifas pagas", cada "Pag.",
 * cada transferência, o rendimento.
 *
 * O casamento vai do mais certo para o menos certo, e cada lançamento casa uma
 * vez só:
 *
 * 1. mesmo dia e mesmo valor;
 * 2. mesmo valor com até 3 dias de diferença (o banco credita no dia útil
 *    seguinte; o IXC registra no dia do pagamento);
 * 3. a soma do dia — o banco que lança a cobrança de um dia num valor só, ou o
 *    contrário — no mesmo dia ou no seguinte.
 *
 * O que sobra dos dois lados é a diferença a explicar, e é o que a
 * contabilidade quer ver.
 */

export interface LancamentoDoIxc {
  id: number;
  dia: string;
  /** Positivo = entrou; negativo = saiu. */
  valor: number;
  historico: string;
}

export function lerLancamentoDoIxc(raw: Record<string, unknown>): LancamentoDoIxc | null {
  const id = idDoIxc(raw.id);
  const dia = diaDoIxc(raw.data);
  if (id === null || !dia) return null;
  const valor = centavos(numero(raw.debito) - numero(raw.credito));
  if (Math.abs(valor) < 0.005) return null;
  return { id, dia, valor, historico: texto(raw.historico) };
}

export interface Casamento {
  tipo: 'exato' | 'data proxima' | 'soma do dia';
  banco: LancamentoDoBanco[];
  ixc: LancamentoDoIxc[];
}

export interface ResultadoDaConciliacao {
  casamentos: Casamento[];
  soNoBanco: LancamentoDoBanco[];
  soNoIxc: LancamentoDoIxc[];
}

const cents = (v: number) => Math.round(v * 100);

export function conciliar(banco: LancamentoDoBanco[], ixc: LancamentoDoIxc[]): ResultadoDaConciliacao {
  const restoBanco = new Set(banco.map((_, i) => i));
  const restoIxc = new Set(ixc.map((_, i) => i));
  const casamentos: Casamento[] = [];

  // 1. Mesmo dia e mesmo valor.
  const porChave = new Map<string, number[]>();
  ixc.forEach((l, i) => {
    const chave = `${l.dia}|${cents(l.valor)}`;
    porChave.set(chave, [...(porChave.get(chave) ?? []), i]);
  });
  banco.forEach((b, i) => {
    const fila = porChave.get(`${b.dia}|${cents(b.valor)}`);
    const j = fila?.find((k) => restoIxc.has(k));
    if (j === undefined) return;
    restoBanco.delete(i);
    restoIxc.delete(j);
    casamentos.push({ tipo: 'exato', banco: [b], ixc: [ixc[j]] });
  });

  // 2. Mesmo valor, até 3 dias de diferença, o mais perto primeiro.
  for (const i of [...restoBanco]) {
    const b = banco[i];
    let melhor: number | null = null;
    let distancia = Infinity;
    for (const j of restoIxc) {
      if (cents(ixc[j].valor) !== cents(b.valor)) continue;
      const d = Math.abs(diasEntre(b.dia, ixc[j].dia));
      if (d <= 3 && d < distancia) {
        melhor = j;
        distancia = d;
      }
    }
    if (melhor === null) continue;
    restoBanco.delete(i);
    restoIxc.delete(melhor);
    casamentos.push({ tipo: 'data proxima', banco: [b], ixc: [ixc[melhor]] });
  }

  // 3. A soma do dia, por sentido: no mesmo dia, ou o IXC um dia antes.
  for (const folga of [0, 1]) {
    const grupos = (lista: Array<{ dia: string; valor: number }>, resto: Set<number>, deslocar: number) => {
      const g = new Map<string, number[]>();
      for (const i of resto) {
        const l = lista[i];
        const dia = deslocar ? deslocarDia(l.dia, deslocar) : l.dia;
        const chave = `${dia}|${l.valor > 0 ? '+' : '-'}`;
        g.set(chave, [...(g.get(chave) ?? []), i]);
      }
      return g;
    };
    const doBanco = grupos(banco, restoBanco, 0);
    const doIxc = grupos(ixc, restoIxc, folga);
    for (const [chave, is] of doBanco) {
      const js = doIxc.get(chave);
      if (!js || js.length === 0) continue;
      const somaBanco = is.reduce((s, i) => s + cents(banco[i].valor), 0);
      const somaIxc = js.reduce((s, j) => s + cents(ixc[j].valor), 0);
      if (somaBanco !== somaIxc) continue;
      is.forEach((i) => restoBanco.delete(i));
      js.forEach((j) => restoIxc.delete(j));
      casamentos.push({ tipo: 'soma do dia', banco: is.map((i) => banco[i]), ixc: js.map((j) => ixc[j]) });
    }
  }

  return {
    casamentos,
    soNoBanco: [...restoBanco].map((i) => banco[i]).sort((a, b) => a.dia.localeCompare(b.dia)),
    soNoIxc: [...restoIxc].map((j) => ixc[j]).sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}

/** "22 diferenças", "1 diferença", "bate". */
export function situacaoDaConciliacao(resumo: Array<{ rotulo: string; valor: number | string }>): string {
  const n = resumo.filter((x) => /^Só no/.test(x.rotulo)).reduce((s, x) => s + Number(x.valor), 0);
  return n === 0 ? 'bate' : `${n} diferença${n > 1 ? 's' : ''}`;
}

/**
 * A planilha do item com todas as contas: a primeira aba põe as contas lado
 * a lado, e cada conta segue com as abas dela, pelo nome curto. Com cinco
 * abas por conta e "Conta …" na frente de todas, a barra do Excel só
 * mostrava as da primeira conta — as outras pareciam não ter conciliação.
 */
export function planilhaDasConciliacoes(relatorios: Relatorio[], de: string, ate: string): Aba[] {
  const nomeDaConta = (r: Relatorio) => r.arquivo.replace(/^Conciliacao /, '');
  const valor = (r: Relatorio, rotulo: string) => r.resumo.find((x) => x.rotulo === rotulo)?.valor ?? null;
  const contas: Aba = {
    nome: 'Contas',
    cabecalho: [`Conciliação bancária — ${diaBr(de)} a ${diaBr(ate)}`],
    colunas: [
      { titulo: 'Conta', tipo: 'texto', largura: 28 },
      { titulo: 'Lançamentos no banco', tipo: 'inteiro', largura: 20 },
      { titulo: 'Conciliados', tipo: 'inteiro', largura: 13 },
      { titulo: 'Só no banco', tipo: 'inteiro', largura: 13 },
      { titulo: 'Só no IXC', tipo: 'inteiro', largura: 13 },
      { titulo: 'Saldo no banco', tipo: 'moeda', largura: 17 },
      { titulo: 'Situação', tipo: 'texto', largura: 16 },
    ],
    linhas: relatorios.map((r) => [
      nomeDaConta(r),
      valor(r, 'Lançamentos no banco'),
      valor(r, 'Conciliados'),
      valor(r, 'Só no banco'),
      valor(r, 'Só no IXC'),
      valor(r, 'Saldo no banco'),
      situacaoDaConciliacao(r.resumo),
    ]),
  };
  const abasDaConta = (r: Relatorio) => {
    const curto = nomeDaConta(r).replace(/^Conta /i, '').slice(0, 17).trim();
    return r.abas.map((a) => ({ ...a, nome: `${curto} - ${a.nome}` }));
  };
  return [contas, ...relatorios.flatMap(abasDaConta)];
}

function deslocarDia(dia: string, dias: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export interface DadosDaConciliacao {
  conta: string;
  de: string;
  ate: string;
  extrato: ExtratoOfx;
  arquivoOfx: string;
  ixc: LancamentoDoIxc[];
  lidoEm: Date;
}

export function relatorioDeConciliacao(dados: DadosDaConciliacao): Relatorio {
  const { de, ate } = dados;
  const doBanco = dados.extrato.lancamentos.filter((l) => l.dia >= de && l.dia <= ate);
  const doIxc = dados.ixc.filter((l) => l.dia >= de && l.dia <= ate);
  const r = conciliar(doBanco, doIxc);

  const entradas = (l: Array<{ valor: number }>) => soma(l.filter((x) => x.valor > 0), (x) => x.valor);
  const saidas = (l: Array<{ valor: number }>) => soma(l.filter((x) => x.valor < 0), (x) => -x.valor);

  const avisos: string[] = [];
  if (dados.extrato.inicio && dados.extrato.inicio > de) {
    avisos.push(`O OFX de ${dados.conta} começa em ${diaBr(dados.extrato.inicio)}, depois do início do período.`);
  }
  if (dados.extrato.fim && dados.extrato.fim < ate) {
    avisos.push(`O OFX de ${dados.conta} termina em ${diaBr(dados.extrato.fim)}, antes do fim do período.`);
  }
  if (r.soNoBanco.length + r.soNoIxc.length > 0) {
    avisos.push(
      `${dados.conta}: ${r.soNoBanco.length} lançamentos só no banco ` +
        `(${reais(soma(r.soNoBanco, (l) => l.valor))}) e ${r.soNoIxc.length} só no IXC ` +
        `(${reais(soma(r.soNoIxc, (l) => l.valor))}).`,
    );
  }

  // O dia a dia: é onde se acha a diferença quando ela existe.
  const dias = [...new Set([...doBanco, ...doIxc].map((l) => l.dia))].sort();
  const linhasDoDia = dias.map((dia) => {
    const b = doBanco.filter((l) => l.dia === dia);
    const x = doIxc.filter((l) => l.dia === dia);
    return [dia, entradas(b), entradas(x), saidas(b), saidas(x), centavos(soma(b, (l) => l.valor) - soma(x, (l) => l.valor))];
  });

  const cabecalho = [
    `Conciliação bancária — ${dados.conta} — ${diaBr(de)} a ${diaBr(ate)}`,
    `Extrato: ${dados.arquivoOfx}. IXC lido em ${dados.lidoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
  ];

  const casadosBanco = r.casamentos.flatMap((c) => c.banco);
  return {
    arquivo: `Conciliacao ${dados.conta}`,
    resumo: [
      quantidade('Lançamentos no banco', doBanco.length),
      quantidade('Conciliados', casadosBanco.length),
      quantidade('Só no banco', r.soNoBanco.length),
      quantidade('Só no IXC', r.soNoIxc.length),
      ...(dados.extrato.saldoFinal !== null ? [moeda('Saldo no banco', dados.extrato.saldoFinal)] : []),
    ],
    avisos,
    abas: [
      {
        nome: 'Resumo',
        cabecalho,
        colunas: [
          { titulo: '', tipo: 'texto', largura: 34 },
          { titulo: 'Banco', tipo: 'moeda', largura: 18 },
          { titulo: 'IXC', tipo: 'moeda', largura: 18 },
          { titulo: 'Diferença', tipo: 'moeda', largura: 16 },
        ],
        linhas: [
          ['Entradas', entradas(doBanco), entradas(doIxc), centavos(entradas(doBanco) - entradas(doIxc))],
          ['Saídas', saidas(doBanco), saidas(doIxc), centavos(saidas(doBanco) - saidas(doIxc))],
          ['Movimento do período', soma(doBanco, (l) => l.valor), soma(doIxc, (l) => l.valor), centavos(soma(doBanco, (l) => l.valor) - soma(doIxc, (l) => l.valor))],
          [],
          ['Saldo final no extrato do banco', dados.extrato.saldoFinal, null, null],
          ['Data do saldo', dados.extrato.saldoEm ? diaBr(dados.extrato.saldoEm) : '', null, null],
          [],
          ['Lançamentos conciliados', casadosBanco.length, r.casamentos.flatMap((c) => c.ixc).length, null],
          ['Só no banco', r.soNoBanco.length, null, null],
          ['Só no IXC', null, r.soNoIxc.length, null],
        ],
      },
      {
        nome: 'Só no banco',
        cabecalho: [cabecalho[0], 'Estão no extrato e não foram achados no IXC.'],
        colunas: [
          { titulo: 'Data', tipo: 'data' },
          { titulo: 'Descrição no banco', tipo: 'texto', largura: 54 },
          { titulo: 'Valor', tipo: 'moeda' },
          { titulo: 'Id no banco', tipo: 'texto', largura: 24 },
        ],
        linhas: r.soNoBanco.map((l) => [l.dia, l.descricao, l.valor, l.id]),
        totais: ['Total', '', soma(r.soNoBanco, (l) => l.valor), ''],
      },
      {
        nome: 'Só no IXC',
        cabecalho: [cabecalho[0], 'Estão no IXC e não foram achados no extrato.'],
        colunas: [
          { titulo: 'Data', tipo: 'data' },
          { titulo: 'Histórico no IXC', tipo: 'texto', largura: 54 },
          { titulo: 'Valor', tipo: 'moeda' },
          { titulo: 'Lançamento no IXC', tipo: 'inteiro', largura: 16 },
        ],
        linhas: r.soNoIxc.map((l) => [l.dia, l.historico, l.valor, l.id]),
        totais: ['Total', '', soma(r.soNoIxc, (l) => l.valor), null],
      },
      {
        nome: 'Dia a dia',
        cabecalho: [cabecalho[0]],
        colunas: [
          { titulo: 'Dia', tipo: 'data' },
          { titulo: 'Entradas no banco', tipo: 'moeda', largura: 17 },
          { titulo: 'Entradas no IXC', tipo: 'moeda', largura: 17 },
          { titulo: 'Saídas no banco', tipo: 'moeda', largura: 17 },
          { titulo: 'Saídas no IXC', tipo: 'moeda', largura: 17 },
          { titulo: 'Diferença do dia', tipo: 'moeda', largura: 17 },
        ],
        linhas: linhasDoDia,
      },
      {
        nome: 'Conciliados',
        cabecalho: [cabecalho[0]],
        colunas: [
          { titulo: 'Como casou', tipo: 'texto', largura: 14 },
          { titulo: 'Data no banco', tipo: 'data' },
          { titulo: 'Descrição no banco', tipo: 'texto', largura: 44 },
          { titulo: 'Valor no banco', tipo: 'moeda' },
          { titulo: 'Data no IXC', tipo: 'data' },
          { titulo: 'Histórico no IXC', tipo: 'texto', largura: 44 },
          { titulo: 'Valor no IXC', tipo: 'moeda' },
        ],
        linhas: r.casamentos.flatMap((c) => {
          const n = Math.max(c.banco.length, c.ixc.length);
          return Array.from({ length: n }, (_, i) => [
            i === 0 ? c.tipo : '',
            c.banco[i]?.dia ?? null,
            c.banco[i]?.descricao ?? '',
            c.banco[i]?.valor ?? null,
            c.ixc[i]?.dia ?? null,
            c.ixc[i]?.historico ?? '',
            c.ixc[i]?.valor ?? null,
          ]);
        }),
      },
    ],
  };
}
