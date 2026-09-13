/**
 * A conferência de estoque — o inventário feito na prateleira, item por item —
 * sem cliente HTTP nenhum, para poder ser conferida caso a caso.
 *
 * Quem conta diz quanto tem; o sistema lança no IXC a diferença:
 *
 *  - **faltou** (o IXC diz 25, contou 20): as 5 vão por transferência para o
 *    almoxarifado "Perdas e Falhas". Saem da conta do lugar contado, e ficam
 *    rastreáveis — no meio de um inventário, a ONU que falta na van do
 *    Anderson costuma aparecer na do Cleyson, e aí ela volta de Perdas sem
 *    compra nova;
 *  - **sobrou** (o IXC diz 20, contou 25): primeiro volta de Perdas e Falhas o
 *    que houver lá desse produto; o resto entra por compra de acerto do
 *    Fornecedor Avulso, com o valor que quem contou informou.
 *
 * Por que não o Inventário do IXC (`inventario_estoque`), que é a tela feita
 * para isto: ele existe no webservice e aceita a gravação, mas o movimento que
 * gera sai errado — testado em 13/09/2026, uma linha "Perdas e Falhas, 0 → 1"
 * gerou uma **saída** de 1 no Almoxarifado Principal. Apagada a linha, o IXC
 * apagou o movimento junto. Os dois caminhos daqui (transferência e compra)
 * são os que já andam em produção, com a releitura do saldo no fim.
 */

import { numeroDoIxc } from './estoque.mapper';

/** A marca das compras que a conferência cria, no campo "Documento" da compra. */
export const DOCUMENTO_DA_CONFERENCIA = 'CONFERENCIA DE ESTOQUE (sistema)';

/** Cinco casas: é o que a quantidade da transferência e da compra levam. */
export function arredondarQtde(n: number): number {
  return Math.round(n * 100000) / 100000;
}

/** Diferença que não é diferença: resto de conta com casas decimais. */
const QUASE_ZERO = 1e-6;

// ---------------------------------------------------------------------------
// Produto comum: pela quantidade
// ---------------------------------------------------------------------------

export interface PlanoPorQuantidade {
  /** Contado − IXC. Positivo sobrou, negativo faltou. */
  diferenca: number;
  /** Quanto sai do almoxarifado contado para Perdas e Falhas. */
  paraPerdas: number;
  /** Quanto volta de Perdas e Falhas para o almoxarifado contado. */
  voltaDePerdas: number;
  /** Quanto entra por compra de acerto. */
  compra: number;
}

/**
 * O que lançar para o saldo do IXC ficar igual ao contado.
 *
 * O saldo negativo entra na conta como é: o IXC diz -3, contou 2 — sobram 5
 * (o negativo zera e ainda entram 2). O saldo de Perdas negativo não devolve
 * nada: não há o que tirar de lá.
 */
export function planejarPorQuantidade(dados: {
  sistema: number;
  contado: number;
  saldoEmPerdas: number;
}): PlanoPorQuantidade {
  const diferenca = arredondarQtde(dados.contado - dados.sistema);
  if (Math.abs(diferenca) < QUASE_ZERO) {
    return { diferenca: 0, paraPerdas: 0, voltaDePerdas: 0, compra: 0 };
  }
  if (diferenca < 0) {
    return { diferenca, paraPerdas: -diferenca, voltaDePerdas: 0, compra: 0 };
  }
  const voltaDePerdas = arredondarQtde(Math.min(diferenca, Math.max(0, dados.saldoEmPerdas)));
  return {
    diferenca,
    paraPerdas: 0,
    voltaDePerdas,
    compra: arredondarQtde(diferenca - voltaDePerdas),
  };
}

// ---------------------------------------------------------------------------
// Patrimônio (ONU, roteador): peça por peça
// ---------------------------------------------------------------------------

/** Uma peça que o IXC diz estar no almoxarifado contado. */
export interface PecaNoAlmoxarifado {
  patrimonioId: number;
  /** `patrimonio.situacao`: 1 e 7 na prateleira; 6 e 8 presas aqui. */
  situacao: string;
  /** Tem MAC, nº patrimonial ou série — é peça de verdade, e não a que um acerto criou vazia. */
  identificada: boolean;
}

export interface PlanoDePecas {
  /** O total contado: pela quantidade, o digitado; por peça, as achadas + trazidas + sem cadastro. */
  contado: number;
  /**
   * Contou pela quantidade menos do que as peças que o IXC tem cadastradas
   * aqui: faltam peças, e só bipando as que estão na prateleira se sabe
   * quais. Nada se lança assim.
   */
  precisaBipar: boolean;
  /** Peças que não foram achadas e vão para Perdas e Falhas. */
  paraPerdas: number[];
  /**
   * Não achadas que ficam, porque movê-las deixaria o saldo negativo: o IXC
   * tem mais peças cadastradas aqui do que saldo (a entrada de acerto cria
   * peça para cobrir negativo — ver `semSaldoParaAPeca`).
   */
  ficamPorFaltaDeSaldo: number[];
  /** Não achadas presas no IXC (alocada, indisponível) — não saem por transferência. */
  presasNaoAchadas: number[];
  /**
   * Saldo sem peça nenhuma que o explique (saldo − peças cadastradas aqui).
   * Negativo quando há mais peças que saldo.
   */
  saldoSemPeca: number;
  /** Quanto desse saldo sem peça vai pela quantidade para Perdas e Falhas. */
  semPecaParaPerdas: number;
  /** Quantas entram por compra de acerto (peças novas, que o IXC cria sem MAC). */
  compra: number;
  /** Achadas que não são deste almoxarifado no IXC — a tela está desatualizada. */
  desconhecidas: number[];
}

const NA_PRATELEIRA = new Set(['1', '7']);

/**
 * O que fazer com as peças de um patrimônio no almoxarifado contado.
 *
 * Dois jeitos de contar, e a regra de cada um:
 *
 *  - **pela quantidade** (`achadas` nulo): serve enquanto o contado cobre as
 *    peças cadastradas aqui. O que se ajusta é o saldo sem peça — na ILNET,
 *    em 13/09/2026, a ONU SIMPLES tinha 756 de saldo e perto de 300 peças.
 *    Contou menos que as peças: faltou ONU de verdade, e é preciso bipar para
 *    saber qual;
 *  - **por peça** (`achadas` com as bipadas): cada unidade contada é uma peça.
 *    As não achadas vão para Perdas, o saldo sem peça também, as trazidas de
 *    outro almoxarifado vêm, e as bipadas que o IXC não conhece entram por
 *    compra.
 *
 * As trazidas contam antes das faltas: elas sobem o saldo, e é esse saldo que
 * decide quantas não achadas dá para mandar para Perdas sem deixar negativo.
 * Das não achadas vão primeiro as identificadas (com série ou número da casa):
 * a peça vazia que um acerto criou não é ONU que sumiu, é a cobertura de um
 * negativo antigo.
 */
export function planejarPecas(dados: {
  saldo: number;
  pecas: PecaNoAlmoxarifado[];
  /** Null: contou pela quantidade, sem bipar. */
  achadas: number[] | null;
  /** Pela quantidade: o total contado. */
  contado?: number;
  trazidas: number;
  semCadastro: number;
}): PlanoDePecas {
  const saldoSemPeca = arredondarQtde(dados.saldo - dados.pecas.length);
  const vazio = {
    paraPerdas: [],
    ficamPorFaltaDeSaldo: [],
    presasNaoAchadas: [],
    desconhecidas: [],
  };

  if (dados.achadas === null) {
    const contado = arredondarQtde(Math.max(0, dados.contado ?? 0));
    if (contado + QUASE_ZERO < dados.pecas.length) {
      return {
        ...vazio,
        contado,
        precisaBipar: true,
        saldoSemPeca,
        semPecaParaPerdas: 0,
        compra: 0,
      };
    }
    const diferenca = arredondarQtde(contado - dados.saldo);
    return {
      ...vazio,
      contado,
      precisaBipar: false,
      saldoSemPeca,
      semPecaParaPerdas: diferenca < -QUASE_ZERO ? -diferenca : 0,
      compra: diferenca > QUASE_ZERO ? diferenca : 0,
    };
  }

  const aqui = new Map(dados.pecas.map((p) => [p.patrimonioId, p]));
  const achadas = new Set(dados.achadas);
  const desconhecidas = [...achadas].filter((id) => !aqui.has(id));

  const naoAchadas = dados.pecas.filter((p) => !achadas.has(p.patrimonioId));
  const presasNaoAchadas = naoAchadas
    .filter((p) => !NA_PRATELEIRA.has(p.situacao))
    .map((p) => p.patrimonioId);
  const soltas = naoAchadas
    .filter((p) => NA_PRATELEIRA.has(p.situacao))
    .sort(
      (a, b) =>
        Number(b.identificada) - Number(a.identificada) || a.patrimonioId - b.patrimonioId,
    );

  /*
   * O saldo sem peça sai também. E das não achadas só vai o que o saldo
   * cobre depois de contar as que ficam (achadas e presas): com saldo 2 e três
   * peças cadastradas, uma delas achada, vai uma só — mandar as duas deixaria
   * a achada sem saldo. As trazidas não entram na conta: sobem o saldo e ficam.
   */
  const semPecaParaPerdas = Math.max(0, saldoSemPeca);
  const ficamAqui = achadas.size - desconhecidas.length + presasNaoAchadas.length;
  const cabem = Math.max(
    0,
    Math.floor(dados.saldo - semPecaParaPerdas - ficamAqui + QUASE_ZERO),
  );
  const paraPerdas = soltas.slice(0, cabem).map((p) => p.patrimonioId);
  const ficamPorFaltaDeSaldo = soltas.slice(cabem).map((p) => p.patrimonioId);

  return {
    contado: achadas.size - desconhecidas.length + dados.trazidas + dados.semCadastro,
    precisaBipar: false,
    paraPerdas,
    ficamPorFaltaDeSaldo,
    presasNaoAchadas,
    saldoSemPeca,
    semPecaParaPerdas,
    compra: dados.semCadastro,
    desconhecidas,
  };
}

/**
 * A peça da linha crua de `patrimonio`, com o que o plano precisa.
 *
 * Visto em produção (13/09/2026): a ONU de verdade tem o número da casa em
 * `serial` ("36249") e a série GPON da etiqueta em `serial_fornecedor`
 * ("FHTTBFFCB068"); a peça que uma compra sem série cria ganha do IXC um
 * código de cinco letras em `serial` ("ZUK6L") e nada mais. Por isso o
 * `serial` só identifica quando é número.
 */
export function pecaDaLinha(l: Record<string, unknown>): PecaNoAlmoxarifado {
  const texto = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v).trim();
    return t !== '' && t !== '0' ? t : null;
  };
  const serial = texto(l.serial);
  return {
    patrimonioId: numeroDoIxc(l.id),
    situacao: String(l.situacao ?? '').trim(),
    identificada: !!(
      texto(l.id_mac) ||
      texto(l.mac) ||
      texto(l.serial_fornecedor) ||
      texto(l.nro_patrimonio) ||
      texto(l.cod_patrimonio) ||
      (serial && /^\d+$/.test(serial))
    ),
  };
}

// ---------------------------------------------------------------------------
// O que foi lançado — guardado na conferência, e o que o "desfazer" percorre
// ---------------------------------------------------------------------------

export interface AlmoxDoLancamento {
  id: number;
  nome: string;
}

export interface PecaDoLancamento {
  patrimonioId: number;
  identificacao: string;
}

export type MotivoDaTransferencia =
  | 'falta'
  | 'volta-de-perdas'
  | 'trazida'
  | 'saldo-sem-peca'
  | 'desfazer';

export interface TransferenciaLancada {
  tipo: 'transferencia';
  motivo: MotivoDaTransferencia;
  /** Null quando o IXC nem abriu a transferência. */
  transferenciaId: number | null;
  de: AlmoxDoLancamento;
  para: AlmoxDoLancamento;
  /** Produto pela quantidade. */
  quantidade?: number;
  /** Patrimônio: as peças que o IXC aceitou. */
  pecas?: PecaDoLancamento[];
  /** O que o IXC recusou (a transferência inteira, ou peças dela). */
  falharam?: Array<PecaDoLancamento & { motivo: string }>;
  ok: boolean;
  erro?: string;
  /** Já voltou pelo "desfazer" — não se volta duas vezes. */
  desfeito?: boolean;
}

export interface CompraLancada {
  tipo: 'compra';
  motivo: 'sobra' | 'desfazer';
  entradaId: number | null;
  quantidade: number;
  valorUnitario: number;
  /** O número que o IXC deu a cada peça que a compra criou (patrimônio). */
  pecasCriadas?: string[];
  ok: boolean;
  erro?: string;
  /** A compra foi apagada pelo "desfazer". */
  apagada?: boolean;
}

export type Lancamento = TransferenciaLancada | CompraLancada;

/** "5 UND para Perdas e Falhas (transferência #812)" — o lançamento dito para gente. */
export function dizerLancamento(l: Lancamento, unidade = ''): string {
  const un = unidade ? ` ${unidade}` : '';
  if (l.tipo === 'compra') {
    const numero = l.entradaId ? ` #${l.entradaId}` : '';
    if (l.motivo === 'desfazer') return `compra${numero} apagada`;
    return l.ok
      ? `${fmt(l.quantidade)}${un} entraram por compra de acerto${numero}`
      : `a compra de acerto${numero} de ${fmt(l.quantidade)}${un} não entrou (${l.erro ?? 'recusada'})`;
  }
  const qtd =
    l.quantidade !== undefined
      ? `${fmt(l.quantidade)}${un}`
      : `${l.pecas?.length ?? 0} ${(l.pecas?.length ?? 0) === 1 ? 'peça' : 'peças'}`;
  const numero = l.transferenciaId ? ` (transferência #${l.transferenciaId})` : '';
  const rota = `de ${l.de.nome} para ${l.para.nome}`;
  if (!l.ok && !l.pecas?.length) {
    return `não foi ${rota}: ${l.erro ?? 'o IXC recusou'}${numero}`;
  }
  return `${qtd} ${rota}${numero}`;
}

function fmt(n: number): string {
  return String(arredondarQtde(n)).replace('.', ',');
}
