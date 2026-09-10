import { Prisma } from '@prisma/client';

/*
 * A conta das parcelas do cartão de crédito, sem banco e sem IXC.
 *
 * Mora num arquivo só dela porque dois serviços precisam dela: o do cartão,
 * que monta as faturas, e o das categorias, que divide a fatura paga pelas
 * categorias das compras que havia dentro. Importar um serviço do outro para
 * isso faria os dois se importarem mutuamente.
 */

/** Uma parcela de uma compra: em que fatura ela cai, e quanto. */
export interface ParcelaDaCompra {
  numero: number;
  competencia: string;
  valor: number;
}

/** O que basta de uma compra para saber em que faturas ela cai, e quanto. */
export interface CompraCalculavel {
  valorTotal: Prisma.Decimal | number | string;
  parcelas: number;
  parcelaInicial: number;
  primeiraFatura: string;
  assinatura?: boolean;
  ultimaFatura?: string | null;
}

/**
 * As parcelas de uma compra, cada uma na sua fatura.
 *
 * A conta é feita em centavos: dividir R$ 100,00 em três com número quebrado
 * dá três de 33,33 e some um centavo — que aparece depois como diferença entre
 * a fatura do banco e a daqui. A sobra vai para a primeira parcela, que é como
 * os bancos fazem.
 *
 * Parcelas antes de `parcelaInicial` não aparecem: a compra que já vinha sendo
 * paga quando foi cadastrada teve as primeiras pagas fora daqui.
 *
 * A assinatura não tem fim, e por isso pede um horizonte: `ate` é a última
 * fatura que interessa a quem pergunta. Sem ele (e sem `ultimaFatura`), ela
 * não devolve nada — uma lista infinita não cabe em lugar nenhum.
 */
export function parcelasDaCompra(
  compra: CompraCalculavel,
  ate?: string,
): ParcelaDaCompra[] {
  if (compra.assinatura) {
    const fim =
      compra.ultimaFatura && (!ate || compra.ultimaFatura < ate)
        ? compra.ultimaFatura
        : ate;
    const valor = Math.round(Number(compra.valorTotal) * 100) / 100;
    const lista: ParcelaDaCompra[] = [];
    for (
      let mes = compra.primeiraFatura, numero = 1;
      fim && mes <= fim;
      mes = somarMeses(mes, 1), numero++
    ) {
      lista.push({ numero, competencia: mes, valor });
    }
    return lista;
  }

  const centavos = Math.round(Number(compra.valorTotal) * 100);
  const n = Math.max(1, compra.parcelas);
  const base = Math.trunc(centavos / n);
  const sobra = centavos - base * n;

  const lista: ParcelaDaCompra[] = [];
  for (let numero = Math.max(1, compra.parcelaInicial); numero <= n; numero++) {
    lista.push({
      numero,
      competencia: somarMeses(
        compra.primeiraFatura,
        numero - compra.parcelaInicial,
      ),
      valor: (numero === 1 ? base + sobra : base) / 100,
    });
  }
  return lista;
}

/** "2026-11" + 3 → "2027-02". */
export function somarMeses(competencia: string, meses: number): string {
  const [ano, mes] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Soma em centavos, para a soma de uma fatura bater com a do banco. */
export function somar(valores: number[]): number {
  return valores.reduce((s, v) => s + Math.round(v * 100), 0) / 100;
}
