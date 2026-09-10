import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Um teto de pedidos por endereço, para as portas abertas do portal.
 *
 * A tela do funcionário abre com o CPF e mais nada — é o que foi pedido, e é o
 * que a torna prática. O preço é que, sem teto, alguém poderia sair testando
 * CPFs em sequência para ver nomes e pontos. Trinta por minuto é folga de sobra
 * para uma pessoa digitando, e trava um robô no primeiro minuto.
 *
 * Fica na memória do processo, e não no banco: é uma defesa de minuto, e ela
 * zerar quando o serviço reinicia não custa nada.
 */
export class LimiteDeTentativas {
  private readonly contagem = new Map<string, { inicio: number; vezes: number }>();

  constructor(
    private readonly maximo = 30,
    private readonly janelaMs = 60_000,
  ) {}

  conferir(req: Request): void {
    const agora = Date.now();
    const chave = enderecoDe(req);
    const atual = this.contagem.get(chave);

    if (!atual || agora - atual.inicio > this.janelaMs) {
      this.contagem.set(chave, { inicio: agora, vezes: 1 });
      this.limpar(agora);
      return;
    }

    atual.vezes += 1;
    if (atual.vezes > this.maximo) {
      throw new HttpException(
        'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Esquece os endereços que já passaram da janela, para o mapa não crescer. */
  private limpar(agora: number): void {
    if (this.contagem.size < 1000) return;
    for (const [chave, c] of this.contagem) {
      if (agora - c.inicio > this.janelaMs) this.contagem.delete(chave);
    }
  }
}

/** O endereço de quem pediu. Atrás do nginx, é o primeiro do X-Forwarded-For. */
function enderecoDe(req: Request): string {
  const encaminhado = req.headers['x-forwarded-for'];
  const primeiro = (Array.isArray(encaminhado) ? encaminhado[0] : encaminhado)
    ?.split(',')[0]
    ?.trim();
  return primeiro || req.ip || 'desconhecido';
}
