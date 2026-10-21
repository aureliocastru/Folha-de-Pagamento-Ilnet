import { randomBytes } from 'node:crypto';
import type { SituacaoNoBanco } from '@prisma/client';
import {
  inferirTipoChavePix,
  normalizarTipoChavePix,
  type TipoChavePix,
} from '../ixc/ixc.financeiro';
import type { StatusDoBanco } from '../modobank/modobank.client';

/** Como um título vai ser pago pelo banco, lido dele mesmo. */
export type ComoPagar =
  | { forma: 'BOLETO'; codigo: string }
  | { forma: 'PIX'; copiaECola: true; codigo: string }
  | {
      forma: 'PIX';
      copiaECola: false;
      /** Do jeito que o banco aceita (CPF só dígitos, celular com +55…). */
      chave: string;
      /**
       * Onze dígitos que tanto são CPF válido quanto celular: a outra
       * leitura, para tentar se a primeira não existir no Pix.
       */
      alternativa: string | null;
    };

/**
 * De onde sai o pagamento: o código de barras, se o título tem; senão a chave
 * Pix (ou o copia e cola guardado no campo da chave).
 *
 * O boleto vem primeiro porque é ele que diz o valor de verdade — o banco cobra
 * o que o boleto pede hoje, com juros. Título com os dois é boleto que alguém
 * também anotou uma chave.
 *
 * Mas quem marcou "Pix" no tipo de pagamento escolheu o Pix: o código de
 * barras que ficou gravado de antes não o desfaz (a fatura do cartão
 * reembolsada por Pix a quem a pagou, 21/10/2026). E o Pix sem chave no
 * título usa a do cadastro do fornecedor — é o que a tela de lançar promete
 * ("em branco usa a chave do fornecedor no IXC").
 *
 * Null = não há por onde pagar.
 */
export function comoPagar(
  raw: Record<string, unknown>,
  doFornecedor?: { chave: string | null; tipo: string | null } | null,
): ComoPagar | null {
  const barras = String(raw.codigo_barras ?? '').replace(/\D/g, '');
  const escolheuPix = /pix/i.test(String(raw.tipo_pagamento ?? ''));
  const daConta = String(raw.chave_pix ?? '').trim();
  const doCadastro = escolheuPix && !daConta ? (doFornecedor?.chave ?? '').trim() : '';
  const chave = daConta || doCadastro;
  /*
   * Guia de arrecadação (começa com 8: DARF, GPS, conta de consumo) com o QR
   * Pix guardado na chave: vai o Pix. A API do ModoBank não paga arrecadação
   * pelo código de barras — só boleto bancário —, e o DARF traz os dois.
   */
  if (barras.startsWith('8') && /^000201/.test(chave)) {
    return { forma: 'PIX', copiaECola: true, codigo: chave };
  }
  if (barras.length >= 44 && !(escolheuPix && chave)) {
    return { forma: 'BOLETO', codigo: barras };
  }

  if (!chave) return null;

  // O rádio do título fala da chave do título; a do cadastro traz o tipo dela.
  const doRadio = doCadastro
    ? normalizarTipoChavePix(doFornecedor?.tipo)
    : (Object.keys(raw)
        .filter((c) => /tipo_?(chave_?)?pix|pix_?tipo/i.test(c))
        .map((c) => normalizarTipoChavePix(raw[c]))
        .find((t) => t !== null) ?? null);

  if (doRadio === 'Código copia e cola' || /^000201/.test(chave)) {
    return { forma: 'PIX', copiaECola: true, codigo: chave };
  }

  const tipo = doRadio ?? inferirTipoChavePix(chave);
  const digitos = chave.replace(/\D/g, '');
  /*
   * Onze dígitos são CPF ou celular, e o formato desempata mal: o rádio do
   * IXC nesta base guarda um código de uma letra, que não se deixa ler. Com o
   * rádio mudo e os onze dígitos servindo para os dois, vai o CPF e fica o
   * celular de reserva — e quem decide qual existe é o diretório do Pix.
   */
  if (!doRadio && digitos.length === 11 && cpfValido(digitos) && /^[1-9]{2}9/.test(digitos)) {
    return {
      forma: 'PIX',
      copiaECola: false,
      chave: digitos,
      alternativa: chaveParaOBanco(digitos, 'Celular'),
    };
  }
  return { forma: 'PIX', copiaECola: false, chave: chaveParaOBanco(chave, tipo), alternativa: null };
}

/** A chave do jeito que o diretório do Pix a guarda. */
export function chaveParaOBanco(chave: string, tipo: TipoChavePix | null): string {
  const s = chave.trim();
  const digitos = s.replace(/\D/g, '');
  switch (tipo) {
    case 'E-mail':
      return s.toLowerCase();
    case 'CPF/CNPJ':
      return digitos;
    case 'Celular':
      if (digitos.length === 13 && digitos.startsWith('55')) return `+${digitos}`;
      if (digitos.length === 11 || digitos.length === 10) return `+55${digitos}`;
      return s.startsWith('+') ? `+${digitos}` : s;
    case 'Aleatória': {
      const hex = s.replace(/-/g, '').toLowerCase();
      return /^[0-9a-f]{32}$/.test(hex)
        ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
        : s;
    }
    default:
      return s;
  }
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

/**
 * Onde o pagamento está, a partir do status do banco. Status que não se
 * conhece não muda nada: melhor continuar esperando do que dar por pago.
 */
export function situacaoDoStatus(
  status: StatusDoBanco | null,
  atual: SituacaoNoBanco,
): SituacaoNoBanco {
  switch (status) {
    case 'LIQUIDATED':
      return 'PAGO';
    case 'WAITING_APPROVAL':
      return 'AGUARDANDO_APROVACAO';
    case 'PROCESSING':
    case 'ON_QUEUE':
    case 'WAITING_CONFIRMATION':
      return 'NO_BANCO';
    case 'CANCELED':
    case 'REFUNDED':
      return 'RECUSADO';
    // Devolvido em parte: saiu dinheiro, e quem decide o que fazer é gente.
    case 'PARTIALLY_REFUNDED':
      return atual;
    default:
      return atual === 'ENVIANDO' ? 'NO_BANCO' : atual;
  }
}

/** Os motivos de Pix que mais aparecem, por extenso. */
const MOTIVOS_DO_PIX: Record<string, string> = {
  AM04: 'saldo insuficiente',
  OZ01: 'saldo insuficiente',
  AM02: 'acima do limite',
  AC03: 'conta de quem recebe inválida',
  AC06: 'conta de quem recebe bloqueada',
  AC07: 'conta de quem recebe encerrada',
  AB03: 'o Pix demorou demais e foi cancelado',
  DS24: 'ninguém aprovou a tempo',
};

export function motivoDoPix(codigo: string | null): string | null {
  if (!codigo) return null;
  const extenso = MOTIVOS_DO_PIX[codigo.toUpperCase()];
  return extenso ? `${extenso} (${codigo})` : `código ${codigo}`;
}

/**
 * A chave de idempotência: letras e números, até 50. Vai o título nela para
 * que, lida no extrato do banco, ainda diga de que conta é.
 */
export function novaChave(idFnApagar: number): string {
  return `ilnet${idFnApagar}t${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

/** "AAAA-MM-DD" do dia em que o dinheiro saiu, no relógio de Brasília. */
export function diaEmBrasilia(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
