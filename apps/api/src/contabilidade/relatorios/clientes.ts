import { centavos, diaBr, diaDoIxc, diasEntre, idDoIxc, numero, texto } from '../ixc-leitura';
import type { Coluna, Valor } from '../planilha';
import { moeda, quantidade, reais, soma, type Relatorio } from './relatorio';

/**
 * 06 — Saldo de clientes: o que os clientes deviam no último dia do período.
 *
 * O IXC só sabe o que está em aberto **hoje**. O saldo de um dia passado é
 * reconstruído para trás, a partir de hoje:
 *
 *     em aberto no dia = em aberto hoje
 *                      + o que foi recebido depois do dia (valor do título)
 *                      + o que foi cancelado depois do dia
 *
 * e só para os títulos que já existiam no dia. É a mesma conta que se faria
 * com o razão na mão, e evita ler meio milhão de títulos pagos.
 *
 * **Que títulos contam.** Este IXC gera o carnê com meses de antecedência: em
 * 30/09/2026 havia quatorze mil boletos emitidos para serviços de novembro em
 * diante. Isso não é dívida — o serviço ainda não foi prestado. Conta o título
 * cujo período de serviço (`data_inicial`) começou até o dia; o que não tem
 * período (taxa, venda parcelada, acordo) conta pela emissão.
 *
 * Título oculto no IXC (`liberado = N`) vai para uma aba à parte, fora do
 * total: ele não aparece na tela do IXC nem é cobrado do cliente.
 */

export interface DadosDoSaldoDeClientes {
  /** O último dia do período: o dia do saldo. */
  dia: string;
  /** Títulos em aberto hoje (status A ou P). */
  abertosHoje: Array<Record<string, unknown>>;
  /** Recebimentos (linhas da `fn_areceber_baixas` com título) depois do dia. */
  recebidosDepois: Array<Record<string, unknown>>;
  /** Os títulos desses recebimentos que não estão em `abertosHoje`. */
  titulosRecebidosDepois: Array<Record<string, unknown>>;
  /** Títulos cancelados depois do dia. */
  canceladosDepois: Array<Record<string, unknown>>;
  clientes: Map<number, { nome: string; documento: string }>;
  /** Quando o IXC foi lido. */
  lidoEm: Date;
}

/** Um título em aberto no dia, como a planilha o mostra. */
export interface TituloEmAberto {
  id: number;
  clienteId: number | null;
  cliente: string;
  documento: string;
  emissao: string | null;
  vencimento: string | null;
  inicioDoServico: string | null;
  fimDoServico: string | null;
  valor: number;
  abertoNoDia: number;
  /** Dias de atraso no dia do saldo (negativo = ainda ia vencer). */
  atraso: number | null;
  situacaoHoje: string;
  contrato: string;
  oculto: boolean;
}

/** A faixa de atraso, como os escritórios de contabilidade costumam separar. */
const FAIXAS: Array<{ rotulo: string; ate: number }> = [
  { rotulo: 'Vencidos há até 30 dias', ate: 30 },
  { rotulo: 'Vencidos de 31 a 90 dias', ate: 90 },
  { rotulo: 'Vencidos de 91 a 180 dias', ate: 180 },
  { rotulo: 'Vencidos de 181 a 365 dias', ate: 365 },
  { rotulo: 'Vencidos há mais de 1 ano', ate: Infinity },
];

export function titulosEmAbertoNoDia(dados: DadosDoSaldoDeClientes): {
  titulos: TituloEmAberto[];
  futurosForaDoSaldo: { quantidade: number; valor: number };
} {
  const { dia } = dados;

  // O que foi recebido depois do dia, por título: é o que volta a dever.
  const recebidoDepois = new Map<number, number>();
  const recebidoEmQuando = new Map<number, string>();
  for (const r of dados.recebidosDepois) {
    const id = idDoIxc(r.id_receber);
    const quando = diaDoIxc(r.data);
    if (id === null || !quando || quando <= dia) continue;
    recebidoDepois.set(id, (recebidoDepois.get(id) ?? 0) + numero(r.credito));
    const anterior = recebidoEmQuando.get(id);
    if (!anterior || quando > anterior) recebidoEmQuando.set(id, quando);
  }

  // Cada título uma vez só, venha de que lista vier. O de hoje manda: é o
  // retrato mais novo do registro.
  const porId = new Map<number, Record<string, unknown>>();
  for (const lista of [dados.titulosRecebidosDepois, dados.canceladosDepois, dados.abertosHoje]) {
    for (const raw of lista) {
      const id = idDoIxc(raw.id);
      if (id !== null) porId.set(id, raw);
    }
  }

  const titulos: TituloEmAberto[] = [];
  let futuros = 0;
  let valorFuturo = 0;

  for (const [id, raw] of porId) {
    const emissao = diaDoIxc(raw.data_emissao);
    if (!emissao || emissao > dia) continue;

    const status = texto(raw.status).toUpperCase();
    const cancelamento = diaDoIxc(raw.data_cancelamento);

    let aberto = 0;
    if (status === 'A' || status === 'P') aberto += numero(raw.valor_aberto);
    aberto += recebidoDepois.get(id) ?? 0;
    if (status === 'C' && cancelamento && cancelamento > dia) {
      aberto += numero(raw.valor_cancelado) || numero(raw.valor);
    }
    // Recebido ou cancelado antes do dia: não devia nada.
    if (status === 'C' && (!cancelamento || cancelamento <= dia)) continue;
    aberto = centavos(aberto);
    if (aberto <= 0.004) continue;

    const inicio = diaDoIxc(raw.data_inicial);
    if (inicio && inicio > dia) {
      futuros += 1;
      valorFuturo += aberto;
      continue;
    }

    const vencimento = diaDoIxc(raw.data_vencimento);
    const clienteId = idDoIxc(raw.id_cliente);
    const cliente = clienteId !== null ? dados.clientes.get(clienteId) : undefined;

    let situacaoHoje = 'Em aberto';
    if (status === 'R' || recebidoDepois.has(id)) {
      const quando = recebidoEmQuando.get(id);
      situacaoHoje =
        status === 'R' ? `Recebido em ${diaBr(quando)}` : `Recebido em parte em ${diaBr(quando)}`;
    } else if (status === 'C') {
      situacaoHoje = `Cancelado em ${diaBr(cancelamento)}`;
    }

    titulos.push({
      id,
      clienteId,
      cliente: cliente?.nome || (clienteId !== null ? `Cliente ${clienteId}` : 'Sem cliente'),
      documento: cliente?.documento ?? '',
      emissao,
      vencimento,
      inicioDoServico: inicio,
      fimDoServico: diaDoIxc(raw.data_final),
      valor: centavos(numero(raw.valor)),
      abertoNoDia: aberto,
      atraso: vencimento ? diasEntre(vencimento, dia) : null,
      situacaoHoje,
      contrato: texto(raw.id_contrato) || texto(raw.id_contrato_avulso),
      oculto: texto(raw.liberado).toUpperCase() === 'N',
    });
  }

  titulos.sort(
    (a, b) =>
      a.cliente.localeCompare(b.cliente, 'pt-BR') ||
      (a.vencimento ?? '').localeCompare(b.vencimento ?? '') ||
      a.id - b.id,
  );

  return { titulos, futurosForaDoSaldo: { quantidade: futuros, valor: centavos(valorFuturo) } };
}

const COLUNAS_DO_TITULO: Coluna[] = [
  { titulo: 'Cliente', tipo: 'texto', largura: 38 },
  { titulo: 'CPF/CNPJ', tipo: 'texto', largura: 20 },
  { titulo: 'Título', tipo: 'inteiro' },
  { titulo: 'Emissão', tipo: 'data' },
  { titulo: 'Vencimento', tipo: 'data' },
  { titulo: 'Dias de atraso', tipo: 'inteiro', largura: 13 },
  { titulo: 'Serviço de', tipo: 'data' },
  { titulo: 'Serviço até', tipo: 'data' },
  { titulo: 'Valor do título', tipo: 'moeda' },
  { titulo: 'Em aberto no dia', tipo: 'moeda', largura: 17 },
  { titulo: 'Situação hoje', tipo: 'texto', largura: 26 },
  { titulo: 'Contrato', tipo: 'texto', largura: 11 },
];

function linhaDoTitulo(t: TituloEmAberto): Valor[] {
  return [
    t.cliente,
    t.documento,
    t.id,
    t.emissao,
    t.vencimento,
    t.atraso !== null && t.atraso > 0 ? t.atraso : null,
    t.inicioDoServico,
    t.fimDoServico,
    t.valor,
    t.abertoNoDia,
    t.situacaoHoje,
    t.contrato,
  ];
}

export function relatorioDeClientes(dados: DadosDoSaldoDeClientes): Relatorio {
  const { dia } = dados;
  const { titulos: todos, futurosForaDoSaldo } = titulosEmAbertoNoDia(dados);
  const titulos = todos.filter((t) => !t.oculto);
  const ocultos = todos.filter((t) => t.oculto);

  const vencidos = titulos.filter((t) => t.vencimento !== null && t.vencimento <= dia);
  const aVencer = titulos.filter((t) => !(t.vencimento !== null && t.vencimento <= dia));
  const total = soma(titulos, (t) => t.abertoNoDia);

  // Cada vencido na primeira faixa que o comporta. O que vence no próprio dia
  // do saldo tem atraso zero e já está vencido: o dia terminou sem pagamento.
  const faixaDe = (t: TituloEmAberto) => FAIXAS.findIndex((f) => (t.atraso ?? 0) <= f.ate);
  const porFaixa = FAIXAS.map((f, i) => {
    const dentro = vencidos.filter((t) => faixaDe(t) === i);
    return { rotulo: f.rotulo, quantidade: dentro.length, valor: soma(dentro, (t) => t.abertoNoDia) };
  });

  // Um cliente por linha: é como a contabilidade confere com o razão dela.
  const porCliente = new Map<string, { nome: string; documento: string; titulos: number; vencido: number; aVencer: number }>();
  for (const t of titulos) {
    const chave = t.clienteId !== null ? String(t.clienteId) : t.cliente;
    const c = porCliente.get(chave) ?? { nome: t.cliente, documento: t.documento, titulos: 0, vencido: 0, aVencer: 0 };
    c.titulos += 1;
    if (t.vencimento !== null && t.vencimento <= dia) c.vencido += t.abertoNoDia;
    else c.aVencer += t.abertoNoDia;
    porCliente.set(chave, c);
  }
  const clientes = [...porCliente.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const cabecalho = [
    `Saldo de clientes em ${diaBr(dia)}`,
    `Lido do IXC em ${dados.lidoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
    'Entra o título cujo serviço começou até o dia (sem período de serviço: emitido até o dia).',
    'Em aberto no dia = em aberto hoje + o que foi recebido ou cancelado depois do dia.',
  ];

  const avisos: string[] = [];
  if (futurosForaDoSaldo.quantidade > 0) {
    avisos.push(
      `${futurosForaDoSaldo.quantidade} boletos já gerados para serviços que começam depois de ` +
        `${diaBr(dia)} (${reais(futurosForaDoSaldo.valor)}) ficaram fora do saldo.`,
    );
  }
  if (ocultos.length > 0) {
    avisos.push(
      `${ocultos.length} títulos ocultos no IXC (${reais(soma(ocultos, (t) => t.abertoNoDia))}) estão ` +
        'numa aba à parte, fora do total.',
    );
  }

  return {
    arquivo: `Saldo de clientes ${diaBr(dia).replace(/\//g, '-')}`,
    resumo: [
      moeda(`Em aberto em ${diaBr(dia)}`, total, true),
      moeda('Vencidos', soma(vencidos, (t) => t.abertoNoDia)),
      moeda('A vencer', soma(aVencer, (t) => t.abertoNoDia)),
      quantidade('Clientes', clientes.length),
      quantidade('Títulos', titulos.length),
    ],
    avisos,
    abas: [
      {
        nome: 'Resumo',
        cabecalho,
        colunas: [
          { titulo: 'Faixa', tipo: 'texto', largura: 34 },
          { titulo: 'Títulos', tipo: 'inteiro' },
          { titulo: 'Valor em aberto', tipo: 'moeda', largura: 18 },
        ],
        linhas: [
          ...porFaixa.map((f) => [f.rotulo, f.quantidade, f.valor]),
          [`A vencer depois de ${diaBr(dia)}`, aVencer.length, soma(aVencer, (t) => t.abertoNoDia)],
        ],
        totais: ['Total', titulos.length, total],
      },
      {
        nome: 'Títulos em aberto',
        cabecalho: [cabecalho[0]],
        colunas: COLUNAS_DO_TITULO,
        linhas: titulos.map(linhaDoTitulo),
        totais: ['Total', '', titulos.length, null, null, null, null, null, soma(titulos, (t) => t.valor), total, '', ''],
      },
      {
        nome: 'Por cliente',
        cabecalho: [cabecalho[0]],
        colunas: [
          { titulo: 'Cliente', tipo: 'texto', largura: 38 },
          { titulo: 'CPF/CNPJ', tipo: 'texto', largura: 20 },
          { titulo: 'Títulos', tipo: 'inteiro' },
          { titulo: 'Vencido', tipo: 'moeda' },
          { titulo: 'A vencer', tipo: 'moeda' },
          { titulo: 'Total', tipo: 'moeda' },
        ],
        linhas: clientes.map((c) => [
          c.nome,
          c.documento,
          c.titulos,
          centavos(c.vencido),
          centavos(c.aVencer),
          centavos(c.vencido + c.aVencer),
        ]),
        totais: [
          'Total',
          '',
          titulos.length,
          soma(vencidos, (t) => t.abertoNoDia),
          soma(aVencer, (t) => t.abertoNoDia),
          total,
        ],
      },
      ...(ocultos.length > 0
        ? [
            {
              nome: 'Ocultos no IXC',
              cabecalho: [
                'Títulos marcados como ocultos no IXC — fora do total',
                'Não aparecem na tela do IXC e não são cobrados do cliente.',
              ],
              colunas: COLUNAS_DO_TITULO,
              linhas: ocultos.map(linhaDoTitulo),
              totais: ['Total', '', ocultos.length, null, null, null, null, null, soma(ocultos, (t) => t.valor), soma(ocultos, (t) => t.abertoNoDia), '', ''],
            },
          ]
        : []),
    ],
  };
}
