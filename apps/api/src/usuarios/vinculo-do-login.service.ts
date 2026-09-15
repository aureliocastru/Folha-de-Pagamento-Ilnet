import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { vincularLogins } from './login-de-campo';

/** O colaborador de um login, como as telas o mostram. */
export interface ColaboradorDoLogin {
  id: string;
  /** Como a pessoa é chamada: o apelido, quando há. */
  nome: string;
  nomeCompleto: string;
  /** Achado pelo nome ou pelo e-mail; falso = ligado pelo administrador. */
  automatico: boolean;
}

/**
 * Que colaborador é cada login — com o banco.
 *
 * A regra mora em `vincularLogins`, onde ela se prova sem banco; aqui só se
 * junta o que ela precisa. E precisa de todo mundo, e não só do login que
 * pergunta: saber se "Tadeu" é o Tadeu depende de não haver outro login
 * disputando a mesma pessoa.
 *
 * Login desligado não é achado pelo nome — um login velho, esquecido, não pode
 * tirar o vínculo de quem entra hoje. O que o administrador ligou à mão vale
 * mesmo com o login desligado, porque é isso que o banco guarda como único.
 */
@Injectable()
export class VinculoDoLoginService {
  constructor(private readonly prisma: PrismaService) {}

  /** O colaborador de cada login, pelo id do login. */
  async todos(): Promise<Map<string, ColaboradorDoLogin>> {
    const [logins, pessoas] = await Promise.all([
      this.prisma.user.findMany({
        where: { OR: [{ ativo: true }, { funcionarioId: { not: null } }] },
        select: { id: true, nome: true, email: true, funcionarioId: true },
      }),
      // Os colaboradores da casa: a mesma régua da folha e do portal.
      this.prisma.funcionario.findMany({
        where: { ativo: true, isentoIcms: true },
        select: { id: true, nome: true, apelido: true, email: true },
      }),
    ]);

    const porId = new Map(pessoas.map((p) => [p.id, p]));
    const resultado = new Map<string, ColaboradorDoLogin>();
    for (const [loginId, v] of vincularLogins(logins, pessoas)) {
      const p = porId.get(v.funcionarioId);
      if (!p) continue;
      resultado.set(loginId, {
        id: p.id,
        nome: p.apelido || p.nome,
        nomeCompleto: p.nome,
        automatico: v.automatico,
      });
    }
    return resultado;
  }

  /** O colaborador deste login, ou null quando não se sabe quem é. */
  async doLogin(usuarioId: string): Promise<ColaboradorDoLogin | null> {
    return (await this.todos()).get(usuarioId) ?? null;
  }
}
