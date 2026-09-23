import type { TipoVeiculo } from '@prisma/client';

/**
 * A manutenção da frota: o que se troca, de quanto em quanto, e quando vence.
 *
 * Fica fora do serviço e sem banco porque é a parte que erra calado: uma conta
 * de "quanto falta" errada não dá erro nenhum — dá um veículo rodando com o
 * óleo vencido e uma tela verde dizendo que está em dia.
 */

/** Um item da lista padrão: o nome, de quantos em quantos km (horas) e meses. */
export interface ItemPadrao {
  nome: string;
  medidor: number | null;
  meses: number | null;
}

/*
 * As médias do mercado para cada tipo, pedidas prontas pelo dono (23/09/2026):
 * "já deixa preenchido a km média que tal coisa precisa ser trocado". São um
 * ponto de partida — o manual de cada veículo manda, e cada item se edita.
 */
const MOTO: ItemPadrao[] = [
  { nome: 'Óleo do motor', medidor: 3000, meses: 6 },
  { nome: 'Filtro de óleo', medidor: 6000, meses: 12 },
  { nome: 'Relação (corrente, coroa e pinhão)', medidor: 20000, meses: null },
  { nome: 'Lubrificar e esticar a corrente', medidor: 1000, meses: null },
  { nome: 'Pneu dianteiro', medidor: 15000, meses: 60 },
  { nome: 'Pneu traseiro', medidor: 12000, meses: 60 },
  { nome: 'Pastilha / lona de freio', medidor: 10000, meses: null },
  { nome: 'Filtro de ar', medidor: 12000, meses: 12 },
  { nome: 'Vela de ignição', medidor: 10000, meses: null },
  { nome: 'Fluido de freio', medidor: null, meses: 24 },
  { nome: 'Bateria', medidor: null, meses: 24 },
];

const CARRO: ItemPadrao[] = [
  { nome: 'Óleo do motor', medidor: 10000, meses: 12 },
  { nome: 'Filtro de óleo', medidor: 10000, meses: 12 },
  { nome: 'Filtro de ar', medidor: 15000, meses: 12 },
  { nome: 'Filtro de combustível', medidor: 20000, meses: 24 },
  { nome: 'Filtro do ar-condicionado', medidor: 15000, meses: 12 },
  { nome: 'Alinhamento e balanceamento', medidor: 10000, meses: 12 },
  { nome: 'Rodízio dos pneus', medidor: 10000, meses: null },
  { nome: 'Pneus', medidor: 50000, meses: 60 },
  { nome: 'Pastilhas de freio', medidor: 30000, meses: null },
  { nome: 'Discos de freio', medidor: 60000, meses: null },
  { nome: 'Correia dentada', medidor: 60000, meses: 48 },
  { nome: 'Correia do alternador', medidor: 60000, meses: 48 },
  { nome: 'Velas de ignição', medidor: 30000, meses: null },
  { nome: 'Fluido de freio', medidor: null, meses: 24 },
  { nome: 'Líquido de arrefecimento', medidor: 40000, meses: 24 },
  { nome: 'Amortecedores', medidor: 60000, meses: null },
  { nome: 'Embreagem', medidor: 80000, meses: null },
  { nome: 'Bateria', medidor: null, meses: 36 },
];

/** A picape a diesel: filtros mais curtos, sem vela, correia mais longa. */
const CAMINHONETE: ItemPadrao[] = [
  { nome: 'Óleo do motor', medidor: 10000, meses: 12 },
  { nome: 'Filtro de óleo', medidor: 10000, meses: 12 },
  { nome: 'Filtro de combustível', medidor: 20000, meses: 12 },
  { nome: 'Filtro de ar', medidor: 20000, meses: 12 },
  { nome: 'Filtro do ar-condicionado', medidor: 15000, meses: 12 },
  { nome: 'Alinhamento e balanceamento', medidor: 10000, meses: 12 },
  { nome: 'Rodízio dos pneus', medidor: 10000, meses: null },
  { nome: 'Pneus', medidor: 60000, meses: 60 },
  { nome: 'Pastilhas de freio', medidor: 30000, meses: null },
  { nome: 'Discos de freio', medidor: 60000, meses: null },
  { nome: 'Correia dentada', medidor: 100000, meses: 60 },
  { nome: 'Correia do alternador', medidor: 60000, meses: 48 },
  { nome: 'Óleo do câmbio', medidor: 60000, meses: 48 },
  { nome: 'Óleo do diferencial', medidor: 60000, meses: 48 },
  { nome: 'Fluido de freio', medidor: null, meses: 24 },
  { nome: 'Líquido de arrefecimento', medidor: 40000, meses: 24 },
  { nome: 'Amortecedores', medidor: 60000, meses: null },
  { nome: 'Embreagem', medidor: 100000, meses: null },
  { nome: 'Bateria', medidor: null, meses: 36 },
];

const CAMINHAO: ItemPadrao[] = [
  { nome: 'Óleo do motor', medidor: 10000, meses: 6 },
  { nome: 'Filtro de óleo', medidor: 10000, meses: 6 },
  { nome: 'Filtro de combustível', medidor: 10000, meses: 6 },
  { nome: 'Separador de água do diesel', medidor: 10000, meses: 6 },
  { nome: 'Filtro de ar', medidor: 20000, meses: 12 },
  { nome: 'Lubrificação (graxa)', medidor: 5000, meses: 3 },
  { nome: 'Óleo do câmbio', medidor: 60000, meses: 24 },
  { nome: 'Óleo do diferencial', medidor: 60000, meses: 24 },
  { nome: 'Pneus', medidor: 80000, meses: 60 },
  { nome: 'Alinhamento', medidor: 20000, meses: 12 },
  { nome: 'Lonas de freio', medidor: 40000, meses: null },
  { nome: 'Correia do motor', medidor: 60000, meses: 36 },
  { nome: 'Líquido de arrefecimento', medidor: null, meses: 24 },
  { nome: 'Embreagem', medidor: 150000, meses: null },
  { nome: 'Bateria', medidor: null, meses: 24 },
];

/** A máquina conta em horas do horímetro, não em km. */
const MAQUINA: ItemPadrao[] = [
  { nome: 'Óleo do motor', medidor: 250, meses: 6 },
  { nome: 'Filtro de óleo', medidor: 250, meses: 6 },
  { nome: 'Filtro de combustível', medidor: 500, meses: 12 },
  { nome: 'Filtro de ar', medidor: 500, meses: 12 },
  { nome: 'Lubrificação (graxa)', medidor: 50, meses: null },
  { nome: 'Filtro do hidráulico', medidor: 500, meses: 12 },
  { nome: 'Óleo do hidráulico', medidor: 2000, meses: 24 },
  { nome: 'Óleo da transmissão', medidor: 1000, meses: 24 },
  { nome: 'Correia do motor', medidor: 1000, meses: 24 },
  { nome: 'Líquido de arrefecimento', medidor: 2000, meses: 24 },
  { nome: 'Bateria', medidor: null, meses: 24 },
];

/** A lista que um veículo novo já ganha, pelo tipo. O galão não anda: não tem. */
export function itensPadrao(tipo: TipoVeiculo): ItemPadrao[] {
  switch (tipo) {
    case 'MOTO':
      return MOTO;
    case 'CARRO':
    case 'OUTRO':
      return CARRO;
    case 'CAMINHONETE':
      return CAMINHONETE;
    case 'CAMINHAO':
      return CAMINHAO;
    case 'MAQUINA':
      return MAQUINA;
    case 'GALAO':
      return [];
  }
}

/** Todos os nomes que a casa conhece, para sugerir ao adicionar um item. */
export const NOMES_CONHECIDOS = [
  ...new Set([...MOTO, ...CARRO, ...CAMINHONETE, ...CAMINHAO, ...MAQUINA].map((i) => i.nome)),
].sort((a, b) => a.localeCompare(b, 'pt-BR'));

/**
 * Em dia, perto (usou 90% ou mais), vencido; sem a última troca informada; ou
 * com ela, mas sem o km de agora — o veículo ainda não teve abastecimento.
 */
export type EstadoDoItem = 'VENCIDO' | 'PERTO' | 'EM_DIA' | 'SEM_REGISTRO' | 'SEM_MEDIDOR';

/** Usou isto da vida útil e já está "perto". */
export const PERTO_A_PARTIR_DE = 0.9;

const DIA_MS = 24 * 60 * 60 * 1000;

export interface SituacaoDoItem {
  estado: EstadoDoItem;
  /** Quanto da vida útil já foi — 0,5 é metade; passa de 1 quando vence. */
  usado: number | null;
  /** Km (ou horas) que faltam; negativo = passou. Null sem medidor. */
  faltaMedidor: number | null;
  /** Com quanto no painel ele vence. */
  venceComMedidor: number | null;
  /** Dias que faltam; negativo = passou. Null sem prazo em meses. */
  faltaDias: number | null;
  /** Em que dia ele vence pelo tempo (AAAA-MM-DD). */
  venceEm: string | null;
}

/** O mesmo dia, `meses` depois — dia 31 em mês de 30 cai no último dia dele. */
export function somarMeses(data: Date, meses: number): Date {
  const ano = data.getUTCFullYear();
  const mes = data.getUTCMonth() + meses;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(data.getUTCDate(), ultimo)));
}

/**
 * Onde este item está: o que vencer primeiro manda.
 *
 * O óleo "10.000 km ou 12 meses" parado no pátio vence pelo calendário, e o
 * que roda muito vence pelo km — a situação é a do pior dos dois. Sem a
 * última troca não há de onde contar, e isso se diz em vez de se chutar.
 */
export function situacaoDoItem(
  item: {
    intervaloMedidor: number | null;
    intervaloMeses: number | null;
    ultimaTrocaMedidor: number | null;
    ultimaTrocaEm: Date | null;
  },
  medidorAtual: number | null,
  hoje: Date,
): SituacaoDoItem {
  let usado: number | null = null;
  let faltaMedidor: number | null = null;
  let venceComMedidor: number | null = null;
  let faltaDias: number | null = null;
  let venceEm: string | null = null;

  if (item.intervaloMedidor && item.ultimaTrocaMedidor != null) {
    venceComMedidor = item.ultimaTrocaMedidor + item.intervaloMedidor;
    if (medidorAtual != null) {
      const andou = Math.max(0, medidorAtual - item.ultimaTrocaMedidor);
      faltaMedidor = Math.round((venceComMedidor - medidorAtual) * 10) / 10;
      usado = andou / item.intervaloMedidor;
    }
  }

  if (item.intervaloMeses && item.ultimaTrocaEm) {
    const vence = somarMeses(item.ultimaTrocaEm, item.intervaloMeses);
    venceEm = vence.toISOString().slice(0, 10);
    const dia = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
    faltaDias = Math.round((vence.getTime() - dia) / DIA_MS);
    const total = (vence.getTime() - item.ultimaTrocaEm.getTime()) / DIA_MS;
    const passou = (dia - item.ultimaTrocaEm.getTime()) / DIA_MS;
    const peloTempo = total > 0 ? Math.max(0, passou) / total : 0;
    usado = usado == null ? peloTempo : Math.max(usado, peloTempo);
  }

  const semRegistro = item.ultimaTrocaMedidor == null && item.ultimaTrocaEm == null;
  const estado: EstadoDoItem = semRegistro
    ? 'SEM_REGISTRO'
    : usado == null
      ? 'SEM_MEDIDOR'
      : usado >= 1
        ? 'VENCIDO'
        : usado >= PERTO_A_PARTIR_DE
          ? 'PERTO'
          : 'EM_DIA';

  return {
    estado,
    usado: usado == null ? null : Math.round(usado * 1000) / 1000,
    faltaMedidor,
    venceComMedidor,
    faltaDias,
    venceEm,
  };
}

/** A ordem da lista: o que precisa de atenção primeiro, e dentro de cada um o mais gasto. */
export function ordemDeAtencao(a: SituacaoDoItem, b: SituacaoDoItem): number {
  const peso: Record<EstadoDoItem, number> = {
    VENCIDO: 0,
    PERTO: 1,
    SEM_REGISTRO: 2,
    SEM_MEDIDOR: 3,
    EM_DIA: 4,
  };
  return peso[a.estado] - peso[b.estado] || (b.usado ?? 0) - (a.usado ?? 0);
}
