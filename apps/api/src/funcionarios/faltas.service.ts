import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  calcularDescontoDeFaltas,
  type FaltasDoMes,
} from '../financeiro/faltas.calc';
import { PrismaService } from '../prisma/prisma.service';

/**
 * O calendário de faltas.
 *
 * Marca-se o dia; o desconto sai sozinho — o dia mais o descanso semanal
 * daquela semana, que é o que a CLT tira de quem falta sem justificar. É o
 * segundo que sempre escapava de quem calculava à mão.
 *
 * Só vale para quem **não** tem carteira assinada. Com carteira, quem desconta
 * falta é a contabilidade, na folha oficial; marcar aqui tiraria o mesmo dia
 * duas vezes da mesma pessoa, e é o tipo de erro que só aparece quando ela
 * reclama do valor.
 */
@Injectable()
export class FaltasService {
  private readonly logger = new Logger(FaltasService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** As faltas de um mês, com o que elas custam. */
  async doMes(funcionarioId: string, competencia: string) {
    const f = await this.exigirFuncionario(funcionarioId);

    const faltas = await this.prisma.faltaFuncionario.findMany({
      where: { funcionarioId, competencia: mesValido(competencia) },
      orderBy: { data: 'asc' },
    });

    return {
      competencia,
      /**
       * Com carteira assinada o calendário nem aparece na tela; a resposta diz
       * isso para ela não precisar deduzir do cadastro.
       */
      aplicavel: !f.carteiraAssinada,
      salarioBase: Number(f.salarioBase),
      /*
       * O dia vai como texto, e não como instante.
       *
       * Um `Date` serializado vira "2026-08-03T00:00:00.000Z", e o navegador em
       * Brasília relê isso como 2 de agosto às 21h — o dia 3 aparecia marcado
       * no quadrado do dia 2. Data de calendário não tem hora nem fuso; quem
       * manda os dois convida quem recebe a errar.
       */
      dias: faltas.map((x) => ({
        id: x.id,
        dia: diaISO(x.data),
        observacao: x.observacao,
      })),
      desconto: calcularDescontoDeFaltas(
        Number(f.salarioBase),
        faltas.map((x) => x.data),
      ),
    };
  }

  /**
   * Marca ou desmarca um dia — o mesmo clique nas duas direções.
   *
   * Um calendário em que marcar e desmarcar são botões diferentes obriga a
   * pensar em qual usar; aqui o dia responde ao toque, e o estado é o que está
   * pintado.
   */
  async alternar(
    funcionarioId: string,
    dia: string,
    usuarioId?: string,
  ): Promise<{ marcado: boolean }> {
    const f = await this.exigirFuncionario(funcionarioId);
    if (f.carteiraAssinada) {
      throw new BadRequestException(
        `${f.nome} tem carteira assinada: a falta dele é descontada pela ` +
          'contabilidade, na folha oficial. Marcar aqui descontaria o mesmo ' +
          'dia duas vezes.',
      );
    }

    const data = dataDoDia(dia);
    const jaTem = await this.prisma.faltaFuncionario.findUnique({
      where: { funcionarioId_data: { funcionarioId, data } },
    });

    if (jaTem) {
      await this.prisma.faltaFuncionario.delete({ where: { id: jaTem.id } });
      this.logger.log(`Falta de ${f.nome} em ${dia} desmarcada.`);
      return { marcado: false };
    }

    await this.prisma.faltaFuncionario.create({
      data: {
        funcionarioId,
        data,
        competencia: dia.slice(0, 7),
        criadoPor: usuarioId ?? null,
      },
    });
    this.logger.log(`Falta de ${f.nome} em ${dia} marcada.`);
    return { marcado: true };
  }

  /**
   * O desconto de cada funcionário numa competência, para a folha — com os dias
   * marcados, que é o que a tela abre para quem pergunta "que falta é essa?".
   *
   * Uma consulta para todos, e não uma por pessoa: a folha do mês passa por
   * dezenas de cadastros, e uma ida ao banco por cadastro é a diferença entre
   * gerar em um segundo e gerar em trinta.
   */
  async descontoDaCompetencia(
    competencia: string,
    funcionarios: Array<{ id: string; salarioBase: number }>,
  ): Promise<Map<string, FaltasDoMes>> {
    const ids = funcionarios.map((f) => f.id);
    if (ids.length === 0) return new Map();

    const faltas = await this.prisma.faltaFuncionario.findMany({
      where: { competencia, funcionarioId: { in: ids } },
      select: { funcionarioId: true, data: true },
    });

    const porFuncionario = new Map<string, Date[]>();
    for (const f of faltas) {
      const lista = porFuncionario.get(f.funcionarioId) ?? [];
      lista.push(f.data);
      porFuncionario.set(f.funcionarioId, lista);
    }

    const desconto = new Map<string, FaltasDoMes>();
    for (const f of funcionarios) {
      const dias = porFuncionario.get(f.id);
      if (!dias?.length) continue;
      desconto.set(f.id, {
        ...calcularDescontoDeFaltas(f.salarioBase, dias),
        datas: dias.map(diaISO).sort(),
      });
    }
    return desconto;
  }

  private async exigirFuncionario(id: string) {
    const f = await this.prisma.funcionario.findUnique({ where: { id } });
    if (!f) throw new BadRequestException('Funcionário não encontrado.');
    return f;
  }
}

/**
 * "AAAA-MM-DD" para a meia-noite **em UTC** daquele dia.
 *
 * Em UTC, e não no fuso do servidor: o container roda em UTC e o navegador em
 * Brasília, e a meia-noite local do servidor relida do outro lado cai no dia
 * anterior. Uma falta é um dia; ela não pode depender de onde o processo está.
 */
function dataDoDia(valor: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor).trim());
  if (!m) {
    throw new BadRequestException('O dia precisa estar no formato AAAA-MM-DD.');
  }
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Este dia não existe no calendário.');
  }
  return d;
}

/** O dia de uma data, em "AAAA-MM-DD", lido em UTC. */
function diaISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function mesValido(competencia: string): string {
  if (!/^\d{4}-\d{2}$/.test(String(competencia).trim())) {
    throw new BadRequestException('A competência precisa ser AAAA-MM.');
  }
  return competencia.trim();
}
