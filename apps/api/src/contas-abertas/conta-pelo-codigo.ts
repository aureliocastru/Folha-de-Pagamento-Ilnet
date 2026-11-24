import { parseIxcId } from '../ixc/ixc.parse';

/**
 * A conta de pagamento de uma conta em aberto, pelo que ela tem preenchido.
 *
 * Boleto com a linha digitável, ou Pix com a chave, é conta que o banco paga
 * sozinho — e quem paga assim é o ModoBank, a conta padrão das Configurações
 * (pedido do dono, 24/11/2026). A mesma regra da janela de lançar/editar, para o
 * que já estava no IXC com outra conta.
 */

const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Uma conta em aberto com código de pagamento que sai por outra conta. */
export interface AcertoDeConta {
  idFnApagar: number;
  idFornecedor: number | null;
  /** A conta de pagamento que está no IXC (`id_contas`). */
  de: number;
  /** A que paga pelo banco: a padrão das Configurações. */
  para: number;
}

/**
 * O título tem o que o banco precisa para pagar: boleto com os 44, 47 ou 48
 * números, ou Pix com a chave escrita. O tipo vem do próprio título — o mesmo
 * que a janela de lançar usa para mostrar um campo ou o outro.
 */
export function temCodigoDePagamento(raw: Record<string, unknown>): boolean {
  const tipo = String(raw.tipo_pagamento ?? '');
  if (/boleto/i.test(tipo)) return [44, 47, 48].includes(digitos(raw.codigo_barras).length);
  if (/pix/i.test(tipo)) return String(raw.chave_pix ?? '').trim() !== '';
  return false;
}

/**
 * As contas, entre os títulos em aberto (já filtrados), que têm código de
 * pagamento e estão numa conta de pagamento que não é a do banco.
 *
 * Fica de fora o título sem conta nenhuma: ele já paga pela padrão (é o que a
 * janela de pagar assume), e escrever isso no IXC seria mexer sem mudar nada.
 */
export function acertosDeConta(
  abertos: Array<Record<string, unknown>>,
  contaDoBanco: number,
): AcertoDeConta[] {
  const acertos: AcertoDeConta[] = [];
  for (const raw of abertos) {
    const idFnApagar = parseIxcId(raw.id);
    const de = parseIxcId(raw.id_contas);
    if (idFnApagar === null || de === null || de === contaDoBanco) continue;
    if (!temCodigoDePagamento(raw)) continue;
    acertos.push({
      idFnApagar,
      idFornecedor: parseIxcId(raw.id_fornecedor ?? raw.fornecedor_id),
      de,
      para: contaDoBanco,
    });
  }
  return acertos;
}
