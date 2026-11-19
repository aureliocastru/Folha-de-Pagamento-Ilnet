import { formatValorBaixaIxc } from '../ixc/ixc.financeiro';
import { centavos, diaDoIxc, idDoIxc, numero, texto } from './ixc-leitura';

/**
 * Tarifas e rentabilidade dos bancos, lançadas no IXC em lote.
 *
 * É o lançamento que se faz à mão em Contabilidade > Lançamentos contábeis
 * para fechar a conciliação: um por dia, por banco. Na tabela
 * (`fn_movim_finan`) ele é um par, conferido no 1797070 (01/11/2026, tarifa
 * de R$ 7,70 na ModoBank), gravado pela tela do IXC:
 *
 * - a **mãe** (`tipo_lanc` M): a conta do razão do banco (`contas.id_planejamento`
 *   — 12833 ModoBank, 6531 Sicoob, 10064 Bradesco), `id_movim_finan` = o
 *   próprio id, o valor do lado do banco: crédito na tarifa (saiu), débito na
 *   rentabilidade (entrou);
 * - a **filha**, da aba "Lançamentos a débito" (`tipo_lanc` D, débito) na
 *   tarifa ou "Lançamentos a crédito" (`tipo_lanc` C, crédito) na
 *   rentabilidade: sempre a conta 240 "Taxas (despesas)", `id_movim_finan` = a
 *   mãe.
 *
 * Histórico "Tarifas" ou "Rentabilidade", documento vazio, dos dois lados.
 * Os pares conferidos (o 1797070 e outros dos três bancos, de tarifa e de
 * rentabilidade) têm uma filha só, sempre na 240.
 *
 * Escrita errada no IXC não dá erro (ver `estorno-do-pagar-no-ixc`): o par
 * gravado é relido e conferido campo a campo antes de se dizer "lançado".
 */

/** "Taxas (despesas)": a contrapartida de toda tarifa e de toda rentabilidade. */
export const CONTA_DAS_TARIFAS = 240;

export type TipoDaTarifa = 'tarifa' | 'rentabilidade';

export const HISTORICO: Record<TipoDaTarifa, string> = {
  tarifa: 'Tarifas',
  rentabilidade: 'Rentabilidade',
};

/**
 * O pedaço do histórico que acha os lançamentos de cada tipo (o `L` do IXC é
 * "contém", sem caso). Pega também os escritos de outro jeito ("tarifas",
 * "Tarifas pagas", o "Tarifa" do Bradesco): para não lançar duas vezes, vale
 * qualquer um que já esteja lá.
 */
export const TRECHO_DO_HISTORICO: Record<TipoDaTarifa, string> = {
  tarifa: 'tarif',
  rentabilidade: 'rentab',
};

/** Um banco em que se lançam tarifas. */
export interface BancoDasTarifas {
  /** `contas.id` — o que a tela escolhe. */
  id: number;
  nome: string;
  /** `contas.id_planejamento`: a conta do razão, que vai na mãe. */
  razaoId: number;
  filialId: number | null;
}

/** Só os três bancos das tarifas; as contas de aplicação têm razão própria. */
const NOME_DOS_BANCOS = /sicoob|modo ?bank|bradesco/i;

/** "Conta Banco Bradesco" → "Bradesco"; "Conta ModoBank PIX" → "ModoBank PIX". */
export function nomeCurto(nome: string): string {
  return nome.replace(/^\s*conta\s+(banco\s+)?/i, '').trim() || nome.trim();
}

/** As contas do IXC (`contas`) em que se lançam tarifas. */
export function bancosDasTarifas(contas: Array<Record<string, unknown>>): BancoDasTarifas[] {
  return contas
    .filter((c) => texto(c.ativo).toUpperCase() !== 'N')
    .filter((c) => /^b/i.test(texto(c.tipo_conta)))
    .filter((c) => NOME_DOS_BANCOS.test(texto(c.conta)) && !/aplica/i.test(texto(c.conta)))
    .map((c) => ({
      id: idDoIxc(c.id),
      nome: nomeCurto(texto(c.conta)),
      razaoId: idDoIxc(c.id_planejamento),
      filialId: idDoIxc(c.filial_padrao),
    }))
    .filter((b): b is BancoDasTarifas => b.id !== null && b.razaoId !== null)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Um lançamento pedido pela tela. */
export interface LinhaDeTarifa {
  /** `contas.id` do banco. */
  banco: number;
  /** AAAA-MM-DD. */
  dia: string;
  tipo: TipoDaTarifa;
  valor: number;
}

/** "2026-11-01" → "01/11/2026", como o IXC recebe a data. */
export function dataDoIxc(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/** O motivo de recusar a linha antes de ir ao IXC, ou null. */
export function problemaDaLinha(linha: LinhaDeTarifa, hoje: string): string | null {
  const [a, m, d] = linha.dia.split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(linha.dia) ||
    data.getUTCFullYear() !== a ||
    data.getUTCMonth() !== m - 1 ||
    data.getUTCDate() !== d
  ) {
    return 'Dia inválido.';
  }
  if (linha.dia > hoje) return 'O dia ainda não chegou.';
  if (linha.dia < '2020-01-01') return 'Dia antigo demais.';
  if (!(linha.valor > 0)) return 'O valor precisa ser maior que zero.';
  if (Math.abs(centavos(linha.valor) - linha.valor) > 1e-9) return 'O valor tem mais de dois centavos.';
  return null;
}

/**
 * Uma linha de `fn_movim_finan`, com os campos da documentação na ordem dela.
 * O valor vai com vírgula e sem milhar, como na baixa do pagar.
 */
function corpo(
  linha: LinhaDeTarifa,
  banco: BancoDasTarifas,
  campos: { idConta: number; lado: 'debito' | 'credito'; tipoLanc: string; idMovimFinan: string },
): Record<string, string> {
  const valor = formatValorBaixaIxc(linha.valor);
  return {
    id_conta: String(campos.idConta),
    data: dataDoIxc(linha.dia),
    data2: '',
    documento: '',
    debito: campos.lado === 'debito' ? valor : '',
    credito: campos.lado === 'credito' ? valor : '',
    historico: HISTORICO[linha.tipo],
    historico2: '',
    tipo_lanc: campos.tipoLanc,
    id_movim_finan: campos.idMovimFinan,
    id_entrada: '',
    id_saida: '',
    ultima_atualizacao: '',
    ...(banco.filialId ? { filial_id: String(banco.filialId) } : {}),
  };
}

/**
 * A mãe: a perna do banco.
 *
 * Na tela do IXC o débito e o crédito dela ficam travados e se enchem quando a
 * filha é salva. Aqui o valor já vai no lado certo — a releitura confere que
 * ele não dobrou nem ficou zerado.
 */
export function corpoDaMae(linha: LinhaDeTarifa, banco: BancoDasTarifas): Record<string, string> {
  return corpo(linha, banco, {
    idConta: banco.razaoId,
    lado: linha.tipo === 'tarifa' ? 'credito' : 'debito',
    tipoLanc: 'M',
    idMovimFinan: '',
  });
}

/** A filha: a conta 240, ligada à mãe, com o valor do outro lado. */
export function corpoDaFilha(
  linha: LinhaDeTarifa,
  banco: BancoDasTarifas,
  idMae: number,
): Record<string, string> {
  const tarifa = linha.tipo === 'tarifa';
  return corpo(linha, banco, {
    idConta: CONTA_DAS_TARIFAS,
    lado: tarifa ? 'debito' : 'credito',
    tipoLanc: tarifa ? 'D' : 'C',
    idMovimFinan: String(idMae),
  });
}

/** Uma tarifa ou rentabilidade que já está no IXC. */
export interface TarifaNoIxc {
  idMae: number;
  idFilhas: number[];
  /** `contas.id` do banco. */
  banco: number;
  dia: string;
  tipo: TipoDaTarifa;
  valor: number;
  historico: string;
  /**
   * As filhas fecham com a mãe: todas na 240, do lado certo, somando o valor
   * dela. As "Tarifas pagas" do Bradesco têm uma filha por boleto (cem e
   * tantas de R$ 0,99) e fecham do mesmo jeito.
   */
  fechado: boolean;
  /** Tem o desenho do que esta tela grava, e então pode ser apagada por aqui. */
  podeApagar: boolean;
}

/** O tipo pelo lado do valor na mãe: crédito no banco é tarifa. */
function tipoDaMae(mae: Record<string, unknown>): TipoDaTarifa | null {
  const debito = numero(mae.debito);
  const credito = numero(mae.credito);
  if (credito > 0 && debito === 0) return 'tarifa';
  if (debito > 0 && credito === 0) return 'rentabilidade';
  return null;
}

/** O histórico é o que esta tela (e a mão do usuário) escreve. */
function historicoNosso(historico: unknown): boolean {
  const h = texto(historico).toLowerCase();
  return h === 'tarifas' || h === 'rentabilidade';
}

/**
 * O par pode ser apagado por aqui: a mãe de um dos bancos, com histórico de
 * tarifa ou rentabilidade, e as filhas todas na 240, de débito ou de crédito.
 *
 * Qualquer outro desenho fica de fora — inclusive as "Tarifas pagas" que o
 * IXC grava sozinho no Bradesco e as baixas de título (filha P). Apagar meio
 * par de baixa é o defeito que travou o 38114.
 */
export function podeApagar(
  mae: Record<string, unknown>,
  filhas: Array<Record<string, unknown>>,
  razoes: number[],
): boolean {
  const id = idDoIxc(mae.id);
  if (id === null) return false;
  if (texto(mae.tipo_lanc).toUpperCase() !== 'M') return false;
  // Vazio também: é como uma gravação que a conferência recusou pode ficar.
  const aponta = idDoIxc(mae.id_movim_finan);
  if (aponta !== null && aponta !== id) return false;
  if (!razoes.includes(idDoIxc(mae.id_conta) ?? -1)) return false;
  if (!historicoNosso(mae.historico)) return false;
  return filhas.every(
    (f) =>
      idDoIxc(f.id) !== id &&
      idDoIxc(f.id_movim_finan) === id &&
      ['D', 'C'].includes(texto(f.tipo_lanc).toUpperCase()) &&
      idDoIxc(f.id_conta) === CONTA_DAS_TARIFAS,
  );
}

/** Monta o que a tela mostra de cada mãe lida (null se não for tarifa nem rentabilidade). */
export function lerTarifaNoIxc(
  mae: Record<string, unknown>,
  filhas: Array<Record<string, unknown>>,
  bancos: BancoDasTarifas[],
): TarifaNoIxc | null {
  const idMae = idDoIxc(mae.id);
  const dia = diaDoIxc(mae.data);
  const tipo = tipoDaMae(mae);
  const banco = bancos.find((b) => b.razaoId === idDoIxc(mae.id_conta));
  if (idMae === null || !dia || !tipo || !banco) return null;
  const minhas = filhas.filter((f) => idDoIxc(f.id_movim_finan) === idMae && idDoIxc(f.id) !== idMae);
  const tarifa = tipo === 'tarifa';
  const valor = centavos(tarifa ? numero(mae.credito) : numero(mae.debito));
  const cents = (v: unknown) => Math.round(numero(v) * 100);
  const fechado =
    minhas.length > 0 &&
    minhas.every(
      (f) =>
        idDoIxc(f.id_conta) === CONTA_DAS_TARIFAS &&
        texto(f.tipo_lanc).toUpperCase() === (tarifa ? 'D' : 'C') &&
        cents(tarifa ? f.credito : f.debito) === 0,
    ) &&
    minhas.reduce((s, f) => s + cents(tarifa ? f.debito : f.credito), 0) === Math.round(valor * 100);
  return {
    idMae,
    idFilhas: minhas.map((f) => idDoIxc(f.id)).filter((x): x is number => x !== null),
    banco: banco.id,
    dia,
    tipo,
    valor,
    historico: texto(mae.historico),
    fechado,
    podeApagar: podeApagar(mae, minhas, bancos.map((b) => b.razaoId)),
  };
}

/** Mesmo banco, dia, tipo e valor: é o mesmo lançamento. */
export function mesmoLancamento(a: Pick<TarifaNoIxc, 'banco' | 'dia' | 'tipo' | 'valor'>, b: LinhaDeTarifa): boolean {
  return (
    a.banco === b.banco &&
    a.dia === b.dia &&
    a.tipo === b.tipo &&
    Math.round(a.valor * 100) === Math.round(b.valor * 100)
  );
}

/**
 * O que está errado no par relido, comparado com o que foi pedido — vazio
 * quando ele é igual ao que a tela do IXC grava.
 */
export function conferirPar(
  linha: LinhaDeTarifa,
  banco: BancoDasTarifas,
  idMae: number,
  mae: Record<string, unknown> | null,
  filhas: Array<Record<string, unknown>>,
): string[] {
  const problemas: string[] = [];
  const cents = (v: unknown) => Math.round(numero(v) * 100);
  const valor = Math.round(linha.valor * 100);
  const tarifa = linha.tipo === 'tarifa';

  if (!mae) return [`a linha do banco (${idMae}) não foi achada depois de gravada`];
  if (texto(mae.tipo_lanc).toUpperCase() !== 'M') problemas.push(`a linha do banco ficou com tipo "${texto(mae.tipo_lanc)}"`);
  if (idDoIxc(mae.id_conta) !== banco.razaoId) problemas.push(`a linha do banco ficou na conta ${texto(mae.id_conta)}`);
  if (diaDoIxc(mae.data) !== linha.dia) problemas.push(`a linha do banco ficou no dia ${texto(mae.data)}`);
  if (idDoIxc(mae.id_movim_finan) !== idMae) {
    problemas.push(`a linha do banco aponta para ${texto(mae.id_movim_finan) || 'nada'}, e não para ela mesma`);
  }
  const ladoMae = cents(tarifa ? mae.credito : mae.debito);
  const outroMae = cents(tarifa ? mae.debito : mae.credito);
  if (ladoMae !== valor || outroMae !== 0) {
    problemas.push(`a linha do banco ficou com débito ${texto(mae.debito)} e crédito ${texto(mae.credito)}`);
  }

  if (filhas.length !== 1) {
    problemas.push(`ficaram ${filhas.length} linhas na conta ${CONTA_DAS_TARIFAS}, e não uma`);
  }
  for (const f of filhas) {
    if (idDoIxc(f.id_conta) !== CONTA_DAS_TARIFAS) problemas.push(`a linha ${texto(f.id)} ficou na conta ${texto(f.id_conta)}`);
    if (texto(f.tipo_lanc).toUpperCase() !== (tarifa ? 'D' : 'C')) {
      problemas.push(`a linha ${texto(f.id)} ficou com tipo "${texto(f.tipo_lanc)}"`);
    }
    const ladoFilha = cents(tarifa ? f.debito : f.credito);
    const outroFilha = cents(tarifa ? f.credito : f.debito);
    if (ladoFilha !== valor || outroFilha !== 0) {
      problemas.push(`a linha ${texto(f.id)} ficou com débito ${texto(f.debito)} e crédito ${texto(f.credito)}`);
    }
  }
  return problemas;
}
