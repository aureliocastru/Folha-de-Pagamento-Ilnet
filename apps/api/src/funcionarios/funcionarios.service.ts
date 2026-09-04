import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TipoLancamento } from '@prisma/client';
import { competenciaSeguinte } from '../financeiro/folha.calc';
import { PrismaService } from '../prisma/prisma.service';
import { LancamentoDto } from './dto/lancamento.dto';
import { QueryFuncionariosDto } from './dto/query-funcionarios.dto';
import { UpdateFuncionarioDto } from './dto/update-funcionario.dto';
import { VariavelMesDto } from './dto/variavel-mes.dto';

@Injectable()
export class FuncionariosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(q: QueryFuncionariosDto) {
    const where: Prisma.FuncionarioWhereInput = {};

    // Funcionário é quem o filtro do IXC marcou (fornecedor ativo + ICMS
    // isento). Os demais cadastros ficam no banco, mas fora da listagem.
    if (q.todos !== 'true') where.isentoIcms = true;

    if (q.busca) {
      // O apelido entra na busca porque é por ele que a pessoa é conhecida:
      // procura-se "Dão", não "Adailton Vieira Pereira". Mesma régua da
      // fantasia do diarista.
      where.OR = [
        { nome: { contains: q.busca, mode: 'insensitive' } },
        { apelido: { contains: q.busca, mode: 'insensitive' } },
        { cpfCnpj: { contains: q.busca, mode: 'insensitive' } },
        { email: { contains: q.busca, mode: 'insensitive' } },
      ];
    }
    if (q.ativo === 'true') where.ativo = true;
    if (q.ativo === 'false') where.ativo = false;

    const [total, itens] = await this.prisma.$transaction([
      this.prisma.funcionario.count({ where }),
      this.prisma.funcionario.findMany({
        where,
        orderBy: { nome: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    return {
      itens,
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  async buscarPorId(id: string) {
    const func = await this.prisma.funcionario.findUnique({
      where: { id },
      include: {
        adiantamentos: { orderBy: { data: 'desc' }, take: 20 },
        lancamentos: { orderBy: [{ competencia: 'desc' }, { tipo: 'asc' }] },
        variaveisMes: { orderBy: { competencia: 'desc' }, take: 12 },
      },
    });
    if (!func) throw new NotFoundException('Funcionário não encontrado');

    /*
     * O avulso já descontado sai da tela.
     *
     * Um lançamento avulso vale por uma competência só: entra no saldo daquela
     * folha e acabou. Continuar na lista depois disso faz a tela mentir de duas
     * maneiras ao mesmo tempo — parece que ainda vai descontar, e a lista vira
     * um arquivo morto que cresce todo mês e esconde o que está para acontecer.
     *
     * A venda do mês vale pela mesma razão, e agora as duas seguem uma régua
     * só: os dois campos guardam **mês trabalhado**, e o que consome os dois é
     * a folha do mês **seguinte** — o que se lança em 08/2026 é pago na folha
     * de 09/2026. Enquanto ficavam na lista depois de pagas, a comissão de
     * julho aparecia ao lado da de agosto sem nada distinguir uma da outra, e
     * quem olhava contava duas a receber onde havia uma.
     *
     * O fixo (sem mês) nunca sai — ele vale todo mês, por definição.
     */
    const avulsos = func.lancamentos.filter((l) => l.competencia);
    /** As competências de folha que consomem o que está nesta tela. */
    const aConsumir = [
      ...avulsos.map((l) => competenciaSeguinte(l.competencia!)),
      ...func.variaveisMes.map((v) => competenciaSeguinte(v.competencia)),
    ];
    const consumidas =
      aConsumir.length === 0
        ? new Set<string>()
        : new Set(
            (
              await this.prisma.contaPagar.findMany({
                where: {
                  funcionarioId: id,
                  tipo: TipoLancamento.SALARIO,
                  competencia: { in: [...new Set(aConsumir)] },
                },
                select: { competencia: true },
              })
            )
              .map((c) => c.competencia)
              .filter((c): c is string => !!c),
          );

    return {
      ...func,
      lancamentos: func.lancamentos.filter(
        (l) => !l.competencia || !consumidas.has(competenciaSeguinte(l.competencia)),
      ),
      variaveisMes: func.variaveisMes.filter(
        (v) => !consumidas.has(competenciaSeguinte(v.competencia)),
      ),
    };
  }

  /**
   * A folha daquela competência já saiu?
   *
   * É o que decide se uma venda ainda pode ser mexida: depois de a folha ter
   * sido gerada, o valor já virou conta a pagar com a comissão detalhada na
   * observação, e mudar o lançamento aqui não muda mais o que foi pago —
   * mudaria só o registro de por que se pagou aquilo.
   */
  private async folhaJaGerada(
    funcionarioId: string,
    competenciaDaFolha: string,
  ): Promise<boolean> {
    const conta = await this.prisma.contaPagar.findFirst({
      where: {
        funcionarioId,
        tipo: TipoLancamento.SALARIO,
        competencia: competenciaDaFolha,
      },
      select: { id: true },
    });
    return !!conta;
  }

  async atualizar(id: string, dto: UpdateFuncionarioDto) {
    await this.assertExiste(id);
    return this.prisma.funcionario.update({
      where: { id },
      data: {
        observacoes: dto.observacoes,
        // Vazio limpa: quem não tem apelido não fica com um em branco gravado.
        ...(dto.apelido === undefined
          ? {}
          : { apelido: dto.apelido.trim() || null }),
        chavePix: dto.chavePix,
        // Vazio limpa: volta a valer a dedução pelo formato da chave.
        ...(dto.tipoChavePix !== undefined
          ? { tipoChavePix: dto.tipoChavePix }
          : {}),
        banco: dto.banco,
        agencia: dto.agencia,
        conta: dto.conta,
        ativo: dto.ativo,
        clt: dto.clt,
        carteiraAssinada: dto.carteiraAssinada,
        recebeAdiantamento: dto.recebeAdiantamento,
        cidadeIxc: dto.cidadeIxc,
        // 0 ou vazio limpa o valor: volta a valer o percentual da configuração.
        ...(dto.valorAdiantamento !== undefined
          ? {
              valorAdiantamento: dto.valorAdiantamento
                ? new Prisma.Decimal(dto.valorAdiantamento)
                : null,
            }
          : {}),
        ...(dto.valorAReceberFolha !== undefined
          ? {
              valorAReceberFolha: dto.valorAReceberFolha
                ? new Prisma.Decimal(dto.valorAReceberFolha)
                : null,
            }
          : {}),
        // Mesma regra do adiantamento: 0/vazio limpa (a pessoa não comissiona).
        ...(dto.valorPorVenda !== undefined
          ? {
              valorPorVenda: dto.valorPorVenda
                ? new Prisma.Decimal(dto.valorPorVenda)
                : null,
            }
          : {}),
        ...(dto.salarioBase !== undefined
          ? { salarioBase: new Prisma.Decimal(dto.salarioBase) }
          : {}),
      },
    });
  }

  // --- Lançamentos (fixos = sem competência; avulsos = com competência) ---
  async listarLancamentos(funcionarioId: string) {
    await this.assertExiste(funcionarioId);
    return this.prisma.lancamento.findMany({
      where: { funcionarioId },
      orderBy: [{ competencia: 'desc' }, { tipo: 'asc' }],
    });
  }

  /**
   * O avulso de uma folha que já saiu é recusado.
   *
   * Ele nascia aceito e sumia no mesmo instante: a competência já consumida
   * some da lista, e a folha daquele mês não é gerada de novo. Ficava um
   * registro invisível que nunca seria pago — foi assim que um bônus de
   * R$ 300,00 lançado em 03/09 para a folha de 08/2026, paga em 07/08,
   * desapareceu sem deixar recado.
   *
   * O mês pedido aqui é o **trabalhado**, como no bloco de vendas: quem
   * trabalhou em agosto recebe no dia 25 de agosto e no quinto dia de
   * setembro, e o lançamento acompanha os dois.
   */
  async criarLancamento(funcionarioId: string, dto: LancamentoDto) {
    await this.assertExiste(funcionarioId);
    await this.assertMesTrabalhadoAberto(funcionarioId, dto.competencia ?? null);
    return this.prisma.lancamento.create({
      data: {
        funcionarioId,
        tipo: dto.tipo,
        descricao: dto.descricao,
        valor: new Prisma.Decimal(dto.valor),
        ativo: dto.ativo ?? true,
        competencia: dto.competencia ?? null,
      },
    });
  }

  async atualizarLancamento(lancamentoId: string, dto: LancamentoDto) {
    const atual = await this.buscarLancamento(lancamentoId);

    /*
     * De onde ele sai: o que já foi pago não se reescreve.
     *
     * O avulso já descontado some da lista da tela, então por esta porta a
     * trava quase nunca dispara — quase. A tela aberta desde antes de a folha
     * ser gerada ainda mostra a linha, e sem isto o "Salvar" gravaria por cima
     * de um lançamento que já virou conta a pagar: a mudança sumiria no
     * recarregar junto com a linha, sem nada dizer que ela não valeu.
     */
    if (
      atual.competencia &&
      (await this.folhaJaGerada(
        atual.funcionarioId,
        competenciaSeguinte(atual.competencia),
      ))
    ) {
      throw new BadRequestException(
        `Este lançamento é do mês trabalhado de ${atual.competencia}, que já ` +
          `foi pago na folha de ${competenciaSeguinte(atual.competencia)}. ` +
          'Mudar aqui não muda o que foi pago — se o valor saiu errado, o ' +
          'acerto é um lançamento novo no mês que ainda vai ser pago.',
      );
    }

    // Para onde ele vai: a mesma régua de quando se cria.
    await this.assertMesTrabalhadoAberto(atual.funcionarioId, dto.competencia ?? null);

    return this.prisma.lancamento.update({
      where: { id: lancamentoId },
      data: {
        tipo: dto.tipo,
        descricao: dto.descricao,
        valor: new Prisma.Decimal(dto.valor),
        ativo: dto.ativo,
        competencia: dto.competencia ?? null,
      },
    });
  }

  async removerLancamento(lancamentoId: string) {
    await this.buscarLancamento(lancamentoId);
    await this.prisma.lancamento.delete({ where: { id: lancamentoId } });
  }

  /**
   * O mês trabalhado ainda pode receber lançamento?
   *
   * Fixo (sem mês) passa sempre: ele vale do mês que vem em diante, não há mês
   * fechado a proteger. O avulso é que precisa da trava — lançar, ou mover,
   * para um mês trabalhado cuja folha já saiu é escrever algo que não seria
   * pago nunca.
   */
  private async assertMesTrabalhadoAberto(
    funcionarioId: string,
    competencia: string | null,
  ) {
    if (!competencia) return;
    if (await this.folhaJaGerada(funcionarioId, competenciaSeguinte(competencia))) {
      throw new BadRequestException(
        `O mês trabalhado de ${competencia} já foi fechado: a folha de ` +
          `${competenciaSeguinte(competencia)} saiu, e um lançamento nele ` +
          'não seria pago nunca. Lance no mês trabalhado que ainda vai ser pago.',
      );
    }
  }

  // --- Variáveis do mês: vendas (comissão) e horas extras ---
  async listarVariaveis(funcionarioId: string) {
    await this.assertExiste(funcionarioId);
    return this.prisma.variavelMes.findMany({
      where: { funcionarioId },
      orderBy: { competencia: 'desc' },
    });
  }

  /**
   * Um registro por competência: salvar de novo sobrescreve o mês.
   *
   * Menos depois de a folha daquele mês ter saído. O mês pago sai da lista da
   * tela, e é justamente por isso que a trava tem de estar aqui: sem a linha
   * na tela, o formulário abre em branco naquele mês, e um "Salvar" apagaria
   * por cima o registro do que já foi pago — sem avisar ninguém, porque a
   * conta a pagar não muda mais.
   */
  async salvarVariaveis(funcionarioId: string, dto: VariavelMesDto) {
    await this.assertExiste(funcionarioId);
    if (await this.folhaJaGerada(funcionarioId, competenciaSeguinte(dto.competencia))) {
      throw new BadRequestException(
        `A folha de ${dto.competencia} já foi gerada e a comissão desse mês já ` +
          'virou conta a pagar. Mudar aqui não muda o que foi pago — se o ' +
          'valor saiu errado, o acerto é um vale ou um lançamento avulso.',
      );
    }
    const dados = {
      vendas: dto.vendas ?? 0,
      valorPorVenda:
        dto.valorPorVenda == null
          ? null
          : new Prisma.Decimal(dto.valorPorVenda),
      horasExtras: new Prisma.Decimal(dto.horasExtras ?? 0),
      observacao: dto.observacao ?? null,
    };
    return this.prisma.variavelMes.upsert({
      where: {
        funcionarioId_competencia: {
          funcionarioId,
          competencia: dto.competencia,
        },
      },
      create: { funcionarioId, competencia: dto.competencia, ...dados },
      update: dados,
    });
  }

  /** Pelo mesmo motivo do salvar: mês já pago não se apaga por aqui. */
  async removerVariaveis(funcionarioId: string, competencia: string) {
    await this.assertExiste(funcionarioId);
    if (await this.folhaJaGerada(funcionarioId, competenciaSeguinte(competencia))) {
      throw new BadRequestException(
        `A folha de ${competencia} já foi gerada: apagar a venda agora deixaria ` +
          'a conta a pagar sem a explicação de onde veio o valor.',
      );
    }
    await this.prisma.variavelMes.deleteMany({
      where: { funcionarioId, competencia },
    });
  }

  /** O lançamento, ou 404. De quem ele é e de que mês decidem se pode mudar. */
  private async buscarLancamento(id: string) {
    const lanc = await this.prisma.lancamento.findUnique({
      where: { id },
      select: { id: true, funcionarioId: true, competencia: true },
    });
    if (!lanc) throw new NotFoundException('Lançamento não encontrado');
    return lanc;
  }

  /** Resumo para dashboard: total, ativos, folha base mensal. */
  async resumo() {
    // Conta o mesmo universo da listagem: só fornecedores isentos de ICMS.
    const funcionario = { isentoIcms: true };
    const [total, ativos, basesDosAtivos, bonus] = await this.prisma.$transaction([
      this.prisma.funcionario.count({ where: funcionario }),
      this.prisma.funcionario.count({ where: { ...funcionario, ativo: true } }),
      // Quem tem carteira assinada entra pelo "a receber na folha" — é esse o
      // dinheiro que sai por aqui; o salário oficial vai pela contabilidade.
      this.prisma.funcionario.findMany({
        where: { ...funcionario, ativo: true },
        select: {
          salarioBase: true,
          carteiraAssinada: true,
          valorAReceberFolha: true,
        },
      }),
      // Bônus fixo é salário recorrente na prática: entra na folha base.
      this.prisma.lancamento.aggregate({
        where: {
          tipo: TipoLancamento.BONUS,
          competencia: null,
          ativo: true,
          funcionario: { ...funcionario, ativo: true },
        },
        _sum: { valor: true },
      }),
    ]);
    const salarios = basesDosAtivos.reduce(
      (soma, f) =>
        soma.add(
          f.carteiraAssinada && f.valorAReceberFolha?.gt(0)
            ? f.valorAReceberFolha
            : f.salarioBase,
        ),
      new Prisma.Decimal(0),
    );
    const bonusFixoMensal = bonus._sum.valor ?? new Prisma.Decimal(0);
    return {
      total,
      ativos,
      inativos: total - ativos,
      salarioBaseMensal: salarios,
      bonusFixoMensal,
      folhaBaseMensal: salarios.add(bonusFixoMensal),
    };
  }

  private async assertExiste(id: string) {
    const existe = await this.prisma.funcionario.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Funcionário não encontrado');
  }
}
