import { TipoLancamento } from '@prisma/client';
import type { FaltasDoMes } from './faltas.calc';

/** Converte "AAAA-MM" em "MM/AAAA" para exibição/observação. */
export function formatCompetencia(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  return m ? `${m[2]}/${m[1]}` : competencia;
}

/** Substitui {competencia} no template de observação. */
export function renderObs(template: string, competencia: string): string {
  return template.replace(/\{competencia\}/g, formatCompetencia(competencia));
}

/**
 * Mês anterior a "AAAA-MM" ("2026-08" → "2026-07").
 *
 * O salário e o bônus pagos numa competência se referem ao mês trabalhado, que
 * é o anterior; só o adiantamento do dia 25 fala do mês corrente.
 */
export function competenciaAnterior(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  if (!m) return competencia;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  return `${anterior.ano}-${String(anterior.mes).padStart(2, '0')}`;
}

/** Mês seguinte a "AAAA-MM" ("2026-12" → "2027-01"). */
export function competenciaSeguinte(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  if (!m) return competencia;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const seguinte = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
  return `${seguinte.ano}-${String(seguinte.mes).padStart(2, '0')}`;
}

/** Percentual do salário adiantado no dia 25 quando não há valor fixo. */
export const PERCENTUAL_ADIANTAMENTO_PADRAO = 40;

export interface DadosFolhaFuncionario {
  salarioBase: number;
  /** CLT: adiantamento já é descontado pela contabilidade */
  carteiraAssinada: boolean;
  /**
   * Só para quem tem carteira assinada: o que a folha daqui paga, já que o
   * salário oficial sai pela contabilidade. Preenchido, substitui o salário
   * base no saldo salarial — mas não no adiantamento do dia 25, que segue os
   * 40% do salário base.
   */
  valorAReceberFolha?: number | null;
  /** opção de receber o adiantamento do dia 25 */
  recebeAdiantamento: boolean;
  /** valor definido no cadastro para o dia 25; vazio = cai no percentual */
  valorAdiantamento?: number | null;
  /** lançamento de adiantamento cadastrado; 0 = usa o percentual */
  adiantamentoFixo: number;
  descontosFixos: number;
  bonusFixo: number;
  /** vendas do mês; a comissão é vendas × valorPorVenda */
  vendas?: number;
  /** quanto a pessoa ganha por venda (na prática R$ 5 ou R$ 50) */
  valorPorVenda?: number;
  /** horas extras do mês — só para quem NÃO tem carteira assinada */
  horasExtras?: number;
  /** parcelas de vale a descontar nesta competência (funcionário deve) */
  descontoVales?: number;
  /** parcelas de acerto a pagar a mais nesta competência (empresa deve) */
  creditoVales?: number;
  /**
   * Faltas do mês, em dinheiro: os dias mais o descanso semanal perdido.
   *
   * Só para quem NÃO tem carteira assinada. Com carteira, quem desconta falta é
   * a contabilidade na folha oficial, e descontar de novo aqui tiraria o mesmo
   * dia duas vezes da mesma pessoa.
   */
  descontoFaltas?: number;
}

/** Saldo salarial aberto em cada parcela, para mostrar e conferir. */
export interface ComposicaoSalario {
  /** Base usada: salário base ou "a receber na folha" (carteira assinada). */
  salarioBase: number;
  /** true quando a base veio do "a receber na folha". */
  usouValorAReceber: boolean;
  vendas: number;
  valorPorVenda: number;
  comissao: number;
  horasExtras: number;
  descontos: number;
  /** vales descontados (o funcionário devia à empresa) */
  vales: number;
  /** acertos somados (a empresa devia ao funcionário) */
  valesCredito: number;
  /** faltas do mês, já com o descanso semanal perdido dentro */
  faltas: number;
  /** valor apurado para o dia 25 (mesmo quando não é abatido aqui) */
  adiantamento: number;
  /** o que de fato saiu do saldo: 0 para quem tem carteira assinada */
  adiantamentoDescontado: number;
  saldo: number;
}

/** Um lançamento anotado que compõe um pagamento: um bônus, um desconto. */
export interface ItemDetalhado {
  /** O que foi escrito ao lançar ("bônus técnico"). */
  descricao: string;
  valor: number;
  /** true = entra todo mês; false = avulso, só neste mês trabalhado. */
  fixo: boolean;
}

/**
 * O que está por trás dos totais da `ComposicaoSalario`: cada bônus e cada
 * desconto com a descrição de quem lançou, as faltas dia a dia e de onde saiu o
 * dia 25. A composição diz *quanto*; isto diz *o quê*, e a soma dos itens fecha
 * com o total dela.
 */
export interface DetalheDaFolha {
  bonus: ItemDetalhado[];
  descontos: ItemDetalhado[];
  /** Lançamentos de adiantamento (quando é deles que o dia 25 sai). */
  adiantamentos: ItemDetalhado[];
  origemAdiantamento: OrigemDoAdiantamento | null;
  /** A observação deixada nas vendas e horas extras do mês. */
  observacaoDoMes: string | null;
  /** null = sem falta no mês, ou carteira assinada (a contabilidade desconta). */
  faltas: FaltasDoMes | null;
}

export interface ParametrosLancamento {
  contaContabilSalario: number;
  contaContabilAdiantamento: number;
  contaContabilBonus: number;
  obsSalario: string; // já renderizado (competência substituída)
  obsAdiantamento: string;
  obsBonus: string;
  /** % do salário no adiantamento do dia 25 (padrão 40) */
  percentualAdiantamento?: number;
}

/**
 * Base do **saldo salarial**. Quem tem carteira assinada recebe o salário
 * oficial pela contabilidade, então a folha daqui trabalha em cima do
 * combinado ("a receber na folha"); sem esse valor, cai no salário base.
 *
 * Não vale para o adiantamento do dia 25: o percentual dele sai sempre do
 * salário base (ver `calcularAdiantamento`).
 */
export function baseDaFolha(d: DadosFolhaFuncionario): number {
  return usaValorAReceber(d)
    ? arredondar(d.valorAReceberFolha ?? 0)
    : arredondar(d.salarioBase);
}

/** A base veio do "a receber na folha" (e não do salário base)? */
export function usaValorAReceber(d: DadosFolhaFuncionario): boolean {
  return d.carteiraAssinada && arredondar(d.valorAReceberFolha ?? 0) > 0;
}

/** De onde saiu o valor do adiantamento do dia 25. */
export interface OrigemDoAdiantamento {
  de: 'CADASTRO' | 'LANCAMENTO' | 'PERCENTUAL';
  /** Só no PERCENTUAL: quantos % do salário base. */
  percentual: number | null;
  /** Só no PERCENTUAL: o salário base de onde o percentual saiu. */
  base: number | null;
}

/**
 * Qual das três regras do adiantamento está valendo. null = quem não recebe
 * adiantamento. É a única dona da ordem de precedência: `calcularAdiantamento`
 * e a tela, que explica o valor, leem a mesma resposta.
 */
export function origemDoAdiantamento(
  d: DadosFolhaFuncionario,
  percentual = PERCENTUAL_ADIANTAMENTO_PADRAO,
): OrigemDoAdiantamento | null {
  if (!d.recebeAdiantamento) return null;
  if (arredondar(d.valorAdiantamento ?? 0) > 0) {
    return { de: 'CADASTRO', percentual: null, base: null };
  }
  if (arredondar(d.adiantamentoFixo) > 0) {
    return { de: 'LANCAMENTO', percentual: null, base: null };
  }
  return { de: 'PERCENTUAL', percentual, base: arredondar(d.salarioBase) };
}

/**
 * Valor do adiantamento do dia 25. Quem não recebe adiantamento fica em zero.
 * Ordem: valor definido no cadastro → lançamento de ADIANTAMENTO → percentual
 * do **salário base** (40% por padrão).
 *
 * O percentual sai sempre do salário base, inclusive para quem tem carteira
 * assinada: o adiantamento é do salário da pessoa, não do combinado que a
 * folha daqui paga ("a receber na folha"). Regra do usuário (2026-08-07).
 */
export function calcularAdiantamento(
  d: DadosFolhaFuncionario,
  percentual = PERCENTUAL_ADIANTAMENTO_PADRAO,
): number {
  const origem = origemDoAdiantamento(d, percentual);
  if (!origem) return 0;
  if (origem.de === 'CADASTRO') return arredondar(d.valorAdiantamento ?? 0);
  if (origem.de === 'LANCAMENTO') return arredondar(d.adiantamentoFixo);
  return arredondar((arredondar(d.salarioBase) * percentual) / 100);
}

export interface OpcoesGeracao {
  incluirAdiantamento?: boolean;
  incluirSalario?: boolean;
  incluirBonus?: boolean;
}

export interface LancamentoCalculado {
  tipo: TipoLancamento; // SALARIO | ADIANTAMENTO | BONUS
  valor: number;
  contaContabil: number;
  observacao: string;
  /**
   * Quanto deste pagamento é comissão de venda, e de quantas vendas. Só o
   * salário traz: a comissão entra dentro dele. Vai junto para a conta a pagar
   * porque, sem ficar escrito lá, "quanto o mês custou em venda" só poderia
   * ser refeito pelas vendas lançadas — e aí lançar uma venda velha mudaria o
   * gasto de um mês já pago.
   */
  vendas?: number;
  comissaoVendas?: number;
}

/** Comissão do mês: quantas vendas a pessoa fez × o valor de cada venda. */
export function calcularComissao(d: DadosFolhaFuncionario): number {
  return arredondar((d.vendas ?? 0) * (d.valorPorVenda ?? 0));
}

/**
 * Horas extras que entram na folha. Quem tem carteira assinada recebe pela
 * contabilidade, então aqui fica zero mesmo que haja valor lançado.
 */
export function calcularHorasExtras(d: DadosFolhaFuncionario): number {
  if (d.carteiraAssinada) return 0;
  return arredondar(d.horasExtras ?? 0);
}

/**
 * Abre o saldo salarial em proventos e descontos. Proventos do mês (comissão
 * de vendas e horas extras) entram aqui em vez de virar contas a pagar
 * separadas: a pessoa recebe um pagamento só, detalhado na observação.
 */
export function detalharSalario(
  d: DadosFolhaFuncionario,
  percentual = PERCENTUAL_ADIANTAMENTO_PADRAO,
): ComposicaoSalario {
  const adiantamento = calcularAdiantamento(d, percentual);
  const adiantamentoDescontado = d.carteiraAssinada ? 0 : adiantamento;
  const comissao = calcularComissao(d);
  const horasExtras = calcularHorasExtras(d);
  const descontos = arredondar(d.descontosFixos);
  const vales = arredondar(d.descontoVales ?? 0);
  const valesCredito = arredondar(d.creditoVales ?? 0);
  // Carteira assinada não desconta falta aqui: a contabilidade já o fez.
  const faltas = d.carteiraAssinada ? 0 : arredondar(d.descontoFaltas ?? 0);
  const base = baseDaFolha(d);

  return {
    salarioBase: base,
    usouValorAReceber: usaValorAReceber(d),
    vendas: d.vendas ?? 0,
    valorPorVenda: arredondar(d.valorPorVenda ?? 0),
    comissao,
    horasExtras,
    descontos,
    vales,
    valesCredito,
    faltas,
    adiantamento,
    adiantamentoDescontado,
    saldo: arredondar(
      base +
        comissao +
        horasExtras +
        valesCredito -
        descontos -
        vales -
        faltas -
        adiantamentoDescontado,
    ),
  };
}

/**
 * O que a folha sugere no lugar do salário quando a pessoa entra de férias.
 *
 * Férias não é saldo salarial: o valor certo é o que a contabilidade apurou, e
 * é ele que quem gera a folha digita. O que sai daqui é só o ponto de partida —
 * o que a pessoa ganha no mês (base, comissão, hora extra) menos os descontos
 * fixos, **sem** o vale e **sem** o adiantamento do dia 25.
 *
 * Os dois ficam de fora porque nenhum deles é abatido de um pagamento de
 * férias: quem está de férias não recebeu o dia 25, e a parcela do vale
 * continua em aberto para a folha seguinte — este pagamento não a baixa.
 */
export function baseParaFerias(c: ComposicaoSalario): number {
  /*
   * A falta continua descontada: quem faltou faltou, e as férias que a
   * contabilidade apura já partem do mês trabalhado como ele foi. Só o vale e o
   * adiantamento voltam, porque nenhum dos dois é abatido de férias.
   */
  return arredondar(
    c.saldo + c.adiantamentoDescontado + c.vales - c.valesCredito,
  );
}

/**
 * Saldo salarial (valor da conta a pagar de SALÁRIO).
 * Para funcionário SEM carteira assinada, o adiantamento é subtraído aqui.
 * Para CLT (carteira assinada), NÃO — a contabilidade já descontou.
 */
export function calcularSaldoSalarial(
  d: DadosFolhaFuncionario,
  percentual = PERCENTUAL_ADIANTAMENTO_PADRAO,
): number {
  return detalharSalario(d, percentual).saldo;
}

/** "1234.5" → "R$ 1.234,50" (sem espaço estranho, o IXC lê como texto). */
export function formatValorBR(valor: number): string {
  const [inteiro, centavos] = Math.abs(valor).toFixed(2).split('.');
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${valor < 0 ? '-' : ''}R$ ${comMilhar},${centavos}`;
}

/**
 * O que explica o saldo salarial na observação da conta a pagar, no formato
 * pedido pelo usuário: " (HORAS EXTRAS: R$ 500,00 · COMISSÃO: 12 x R$ 50,00)".
 * Sem proventos nem vale, devolve string vazia.
 */
export function sufixoObservacaoSalario(d: DadosFolhaFuncionario): string {
  const partes: string[] = [];

  const horasExtras = calcularHorasExtras(d);
  if (horasExtras > 0) partes.push(`HORAS EXTRAS: ${formatValorBR(horasExtras)}`);

  const comissao = calcularComissao(d);
  if (comissao > 0) {
    partes.push(
      `COMISSÃO: ${d.vendas} x ${formatValorBR(d.valorPorVenda ?? 0)} = ` +
        formatValorBR(comissao),
    );
  }

  const credito = arredondar(d.creditoVales ?? 0);
  if (credito > 0) partes.push(`REEMBOLSO: +${formatValorBR(credito)}`);

  const vales = arredondar(d.descontoVales ?? 0);
  if (vales > 0) partes.push(`VALE: -${formatValorBR(vales)}`);

  /*
   * A falta vai nomeada na observação do IXC.
   *
   * É o desconto que a pessoa mais questiona, e o título lá é o único papel que
   * sobra da folha: sem o nome dele, o valor a menos vira uma diferença que
   * ninguém explica sem abrir esta tela.
   */
  const faltas = d.carteiraAssinada ? 0 : arredondar(d.descontoFaltas ?? 0);
  if (faltas > 0) partes.push(`FALTAS: -${formatValorBR(faltas)}`);

  return partes.length > 0 ? ` (${partes.join(' · ')})` : '';
}

/**
 * Monta os lançamentos (contas a pagar) sugeridos para um funcionário numa
 * competência. Só inclui itens com valor positivo.
 */
export function montarLancamentosFolha(
  d: DadosFolhaFuncionario,
  params: ParametrosLancamento,
  opcoes: OpcoesGeracao = {},
): LancamentoCalculado[] {
  const {
    incluirAdiantamento = true,
    incluirSalario = true,
    incluirBonus = true,
  } = opcoes;

  const percentual =
    params.percentualAdiantamento ?? PERCENTUAL_ADIANTAMENTO_PADRAO;
  const adiantamento = calcularAdiantamento(d, percentual);
  const lancamentos: LancamentoCalculado[] = [];

  if (incluirAdiantamento && adiantamento > 0) {
    lancamentos.push({
      tipo: TipoLancamento.ADIANTAMENTO,
      valor: adiantamento,
      contaContabil: params.contaContabilAdiantamento,
      observacao: params.obsAdiantamento,
    });
  }

  if (incluirSalario) {
    const saldo = calcularSaldoSalarial(d, percentual);
    if (saldo > 0) {
      lancamentos.push({
        tipo: TipoLancamento.SALARIO,
        valor: saldo,
        contaContabil: params.contaContabilSalario,
        observacao: params.obsSalario + sufixoObservacaoSalario(d),
        vendas: d.vendas ?? 0,
        comissaoVendas: calcularComissao(d),
      });
    }
  }

  if (incluirBonus && arredondar(d.bonusFixo) > 0) {
    lancamentos.push({
      tipo: TipoLancamento.BONUS,
      valor: arredondar(d.bonusFixo),
      contaContabil: params.contaContabilBonus,
      observacao: params.obsBonus,
    });
  }

  return lancamentos;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
