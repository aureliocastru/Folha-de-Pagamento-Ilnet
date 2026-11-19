import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import { diaDoIxc, lerPorIds } from './ixc-leitura';
import {
  bancosDasTarifas,
  CONTA_DAS_TARIFAS,
  conferirPar,
  corpoDaFilha,
  corpoDaMae,
  ehAFilhaSolta,
  FORMULARIO_DA_FILHA,
  lerTarifaNoIxc,
  mesmoLancamento,
  podeApagar,
  problemaDaLinha,
  TRECHO_DO_HISTORICO,
  type BancoDasTarifas,
  type LinhaDeTarifa,
  type TarifaNoIxc,
  type TipoDaTarifa,
} from './tarifas';

const TABELA = 'fn_movim_finan';

/** Quanto tempo a lista de bancos vale: o cadastro de contas quase nunca muda. */
const BANCOS_VALEM_MS = 10 * 60_000;

/** O período mais longo que a lista lê de uma vez. */
const DIAS_NA_LISTA = 62;

export type ResultadoDaTarifa =
  | { situacao: 'lancado'; lancamento: TarifaNoIxc }
  | { situacao: 'ja-existia'; lancamento: TarifaNoIxc }
  | { situacao: 'conferir'; idMae: number; problemas: string[]; idFilhaSolta?: number };

function hojeEmBrasilia(agora = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function diasEntre(de: string, ate: string): number {
  return (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000;
}

/**
 * Tarifas e rentabilidade dos bancos no IXC, uma linha por vez: a tela manda
 * o lote em fila, e cada pedido é curto — um lote de trinta numa chamada só
 * passaria do minuto que o proxy espera, e uma falha no meio não diria quais
 * entraram. Ver `tarifas.ts` para o desenho do par.
 */
@Injectable()
export class TarifasDoBancoService {
  private readonly logger = new Logger(TarifasDoBancoService.name);
  private bancosGuardados: { em: number; bancos: BancoDasTarifas[] } | null = null;
  /** Lançamentos sendo gravados agora: o mesmo não entra duas vezes ao mesmo tempo. */
  private readonly gravando = new Set<string>();

  constructor(private readonly ixc: IxcClient) {}

  async bancos(): Promise<BancoDasTarifas[]> {
    const guardado = this.bancosGuardados;
    if (guardado && Date.now() - guardado.em < BANCOS_VALEM_MS) return guardado.bancos;
    const res = await this.ixc.list<Record<string, unknown>>('contas', {
      qtype: 'contas.id',
      query: '0',
      oper: '>',
      rp: 200,
      sortname: 'contas.id',
    });
    const bancos = bancosDasTarifas(res.registros);
    if (bancos.length > 0) this.bancosGuardados = { em: Date.now(), bancos };
    return bancos;
  }

  /** As mães de tarifa ou rentabilidade de um banco no período, com as filhas. */
  private async maes(
    banco: BancoDasTarifas,
    de: string,
    ate: string,
    tipo: TipoDaTarifa,
  ): Promise<Array<Record<string, unknown>>> {
    return this.ixc.listAll<Record<string, unknown>>(
      TABELA,
      {
        qtype: `${TABELA}.id_conta`,
        query: String(banco.razaoId),
        oper: '=',
        sortname: `${TABELA}.id`,
        sortorder: 'asc',
        gridParam: [
          { TB: `${TABELA}.data`, OP: '>=', P: de },
          { TB: `${TABELA}.data`, OP: '<=', P: ate },
          { TB: `${TABELA}.tipo_lanc`, OP: '=', P: 'M' },
          { TB: `${TABELA}.historico`, OP: 'L', P: TRECHO_DO_HISTORICO[tipo] },
        ],
      },
      { pageSize: 500, maxPages: 10 },
    );
  }

  private async montar(
    maes: Array<Record<string, unknown>>,
    bancos: BancoDasTarifas[],
  ): Promise<TarifaNoIxc[]> {
    const filhas = await lerPorIds(
      this.ixc,
      TABELA,
      `${TABELA}.id_movim_finan`,
      maes.map((m) => String(m.id)),
    );
    return maes
      .map((m) => lerTarifaNoIxc(m, filhas, bancos))
      .filter((t): t is TarifaNoIxc => t !== null);
  }

  /** O que já está lançado no período, dos três bancos. */
  async lancadas(de: string, ate: string): Promise<TarifaNoIxc[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || ate < de) {
      throw new BadRequestException('Período inválido.');
    }
    if (diasEntre(de, ate) > DIAS_NA_LISTA) {
      throw new BadRequestException(`Escolha um período de até ${DIAS_NA_LISTA} dias.`);
    }
    const bancos = await this.bancos();
    const maes = (
      await Promise.all(
        bancos.flatMap((b) => [
          this.maes(b, de, ate, 'tarifa'),
          this.maes(b, de, ate, 'rentabilidade'),
        ]),
      )
    ).flat();
    // Um histórico com as duas palavras viria duas vezes.
    const unicas = [...new Map(maes.map((m) => [String(m.id), m])).values()];
    const lista = await this.montar(unicas, bancos);
    return lista.sort((a, b) => a.dia.localeCompare(b.dia) || a.idMae - b.idMae);
  }

  /** A mãe e as filhas de um lançamento, relidas do IXC. */
  private async lerPar(idMae: number): Promise<{
    mae: Record<string, unknown> | null;
    filhas: Array<Record<string, unknown>>;
    /** Veio tudo: o IXC não tinha mais linhas ligadas do que as lidas. */
    inteiro: boolean;
  }> {
    const [mae, ligadas] = await Promise.all([
      this.ixc.getById<Record<string, unknown>>(TABELA, `${TABELA}.id`, idMae),
      this.ixc.list<Record<string, unknown>>(TABELA, {
        qtype: `${TABELA}.id_movim_finan`,
        query: String(idMae),
        oper: '=',
        rp: 200,
        sortname: `${TABELA}.id`,
      }),
    ]);
    return {
      mae,
      filhas: ligadas.registros.filter((f) => String(f.id) !== String(idMae)),
      inteiro: ligadas.registros.length >= ligadas.total,
    };
  }

  /**
   * Lança uma tarifa ou rentabilidade: confere que não está lá, grava a mãe,
   * grava a filha, relê as duas e compara com o pedido.
   */
  async lancar(linha: LinhaDeTarifa): Promise<ResultadoDaTarifa> {
    const problema = problemaDaLinha(linha, hojeEmBrasilia());
    if (problema) throw new BadRequestException(problema);
    const bancos = await this.bancos();
    const banco = bancos.find((b) => b.id === linha.banco);
    if (!banco) throw new BadRequestException('Banco que não recebe tarifa por aqui.');

    const chave = `${banco.id}|${linha.dia}|${linha.tipo}|${Math.round(linha.valor * 100)}`;
    if (this.gravando.has(chave)) {
      throw new ConflictException('Esse lançamento já está sendo gravado.');
    }
    this.gravando.add(chave);
    try {
      const doDia = await this.montar(await this.maes(banco, linha.dia, linha.dia, linha.tipo), bancos);
      const existente = doDia.find((t) => mesmoLancamento(t, linha));
      // Uma linha do banco sem a 240 que feche com ela (uma gravação que caiu
      // no meio) não é "já lançado": é para apagar e lançar de novo.
      if (existente && !existente.fechado) {
        return {
          situacao: 'conferir',
          idMae: existente.idMae,
          problemas: [`a linha do banco ${existente.idMae} desse dia e valor já está no IXC, mas sem a conta 240 fechando com ela`],
        };
      }
      if (existente) return { situacao: 'ja-existia', lancamento: existente };
      return await this.gravar(linha, banco, bancos);
    } finally {
      this.gravando.delete(chave);
    }
  }

  private async gravar(
    linha: LinhaDeTarifa,
    banco: BancoDasTarifas,
    bancos: BancoDasTarifas[],
  ): Promise<ResultadoDaTarifa> {
    const rotulo = `${linha.tipo} ${banco.nome} ${linha.dia} R$ ${linha.valor.toFixed(2)}`;

    const corpoMae = corpoDaMae(linha, banco);
    const mae = await this.ixc.create(TABELA, corpoMae);
    this.logger.log(`Tarifa (${rotulo}): mãe ${JSON.stringify(corpoMae)} → ${JSON.stringify(mae.raw).slice(0, 300)}`);
    if (mae.id === null) {
      throw new ConflictException(
        `O IXC não devolveu o número da linha do banco (${JSON.stringify(mae.raw).slice(0, 200)}). ` +
          'Confira no IXC antes de lançar de novo.',
      );
    }

    const formulario = FORMULARIO_DA_FILHA[linha.tipo];
    const corpoFilha = corpoDaFilha(linha, mae.id);
    let idFilha: number | null = null;
    let falhaDaFilha: string | null = null;
    try {
      const filha = await this.ixc.create(formulario, corpoFilha);
      idFilha = filha.id;
      this.logger.log(
        `Tarifa (${rotulo}): filha ${formulario} ${JSON.stringify(corpoFilha)} → ${JSON.stringify(filha.raw).slice(0, 300)}`,
      );
    } catch (err) {
      falhaDaFilha = err instanceof Error ? err.message : String(err);
      this.logger.error(`Tarifa (${rotulo}): filha deu erro (${falhaDaFilha})`);
    }

    // Sem número (erro de rede, resposta estranha): a filha pode ter entrado
    // mesmo assim — ligada (a releitura acha) ou solta (procura aqui).
    if (idFilha === null) {
      const { filhas } = await this.lerPar(mae.id);
      idFilha = filhas.length > 0 ? Number(filhas[0].id) : await this.acharFilhaSolta(mae.id);
      if (idFilha === null) {
        // A mãe sozinha fica no razão do banco sem contrapartida: sai.
        await this.desfazerMaeSozinha(mae.id);
        throw new ConflictException(`O IXC recusou a linha da conta 240${falhaDaFilha ? `: ${falhaDaFilha}` : '.'}`);
      }
    }
    return this.conferir(linha, banco, bancos, mae.id, idFilha, rotulo);
  }

  /** Relê o par e diz se ficou como a tela do IXC grava. */
  private async conferir(
    linha: LinhaDeTarifa,
    banco: BancoDasTarifas,
    bancos: BancoDasTarifas[],
    idMae: number,
    idFilha: number,
    rotulo: string,
  ): Promise<ResultadoDaTarifa> {
    const { mae: relida, filhas } = await this.lerPar(idMae);
    this.logger.log(
      `Tarifa (${rotulo}): relido mãe ${JSON.stringify(relida)} filhas ${JSON.stringify(filhas)}`,
    );
    const problemas = conferirPar(linha, banco, idMae, relida, filhas);
    const solta = !filhas.some((f) => String(f.id) === String(idFilha));
    if (solta) problemas.push(`a linha ${idFilha} da conta 240 ficou solta`);
    if (problemas.length > 0) {
      this.logger.error(`Tarifa (${rotulo}): conferência achou ${problemas.join('; ')}`);
      return { situacao: 'conferir', idMae, problemas, ...(solta ? { idFilhaSolta: idFilha } : {}) };
    }
    const lancamento = lerTarifaNoIxc(relida!, filhas, bancos);
    if (!lancamento) return { situacao: 'conferir', idMae, problemas: ['o par relido não se leu'] };
    return { situacao: 'lancado', lancamento };
  }

  /** A filha que o IXC gravou solta logo depois desta mãe, se houver uma. */
  private async acharFilhaSolta(idMae: number): Promise<number | null> {
    const mae = await this.ixc.getById<Record<string, unknown>>(TABELA, `${TABELA}.id`, idMae);
    const dia = mae ? diaDoIxc(mae.data) : null;
    if (!mae || !dia) return null;
    const candidatas = await this.ixc.listAll<Record<string, unknown>>(
      TABELA,
      {
        qtype: `${TABELA}.id_conta`,
        query: String(CONTA_DAS_TARIFAS),
        oper: '=',
        sortname: `${TABELA}.id`,
        sortorder: 'asc',
        gridParam: [
          { TB: `${TABELA}.data`, OP: '>=', P: dia },
          { TB: `${TABELA}.data`, OP: '<=', P: dia },
          { TB: `${TABELA}.id`, OP: '>', P: String(idMae) },
        ],
      },
      { pageSize: 500, maxPages: 10 },
    );
    const solta = candidatas.find((f) => ehAFilhaSolta(mae, f) && String(f.id_movim_finan) === String(f.id));
    return solta ? Number(solta.id) : null;
  }

  /** Apaga a mãe que ficou sem filha. */
  private async desfazerMaeSozinha(idMae: number): Promise<void> {
    try {
      const r = await this.ixc.remove(TABELA, idMae);
      this.logger.log(`Tarifa: desfazer mãe ${idMae} → ${JSON.stringify(r).slice(0, 200)}`);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.error(`Tarifa: não deu para desfazer a mãe ${idMae}: ${motivo}`);
    }
  }

  /**
   * Apaga um lançamento de tarifa ou rentabilidade: as filhas primeiro, depois
   * a mãe — assim, se algo parar no meio, sobra no máximo uma linha do banco
   * sem contrapartida, e nunca uma filha sem mãe (o 38114).
   */
  async apagar(idMae: number, idFilhaSolta?: number): Promise<{ apagados: number[] }> {
    const { mae, filhas, inteiro } = await this.lerPar(idMae);
    if (!mae) throw new NotFoundException('Esse lançamento não está mais no IXC.');
    const bancos = await this.bancos();
    if (!inteiro || !podeApagar(mae, filhas, bancos.map((b) => b.razaoId))) {
      throw new BadRequestException(
        'Esse lançamento não tem o desenho de uma tarifa ou rentabilidade lançada à mão — apague pelo IXC.',
      );
    }
    // A filha que ficou solta (gravação que a conferência recusou) sai junto.
    const aApagar = [...filhas];
    if (idFilhaSolta !== undefined && !filhas.some((f) => String(f.id) === String(idFilhaSolta))) {
      const solta = await this.ixc.getById<Record<string, unknown>>(TABELA, `${TABELA}.id`, idFilhaSolta);
      if (!solta || !ehAFilhaSolta(mae, solta) || String(solta.id_movim_finan) !== String(solta.id)) {
        throw new BadRequestException(`A linha ${idFilhaSolta} não é a 240 solta desse lançamento.`);
      }
      aApagar.push(solta);
    }

    const apagados: number[] = [];
    for (const f of aApagar) {
      const id = Number(f.id);
      const r = await this.ixc.remove(TABELA, id);
      this.logger.log(`Tarifa: apagar filha ${id} → ${JSON.stringify(r).slice(0, 200)}`);
      apagados.push(id);
    }
    const depois = await this.lerPar(idMae);
    if (
      idFilhaSolta !== undefined &&
      (await this.ixc.getById<Record<string, unknown>>(TABELA, `${TABELA}.id`, idFilhaSolta)) !== null
    ) {
      throw new ConflictException(`A linha ${idFilhaSolta} da conta 240 continua no IXC. Confira lá.`);
    }
    if (depois.filhas.length > 0) {
      throw new ConflictException(
        `A linha ${String(depois.filhas[0].id)} da conta 240 continua no IXC. Confira lá.`,
      );
    }

    const r = await this.ixc.remove(TABELA, idMae);
    this.logger.log(`Tarifa: apagar mãe ${idMae} → ${JSON.stringify(r).slice(0, 200)}`);
    apagados.push(idMae);
    const fim = await this.lerPar(idMae);
    if (fim.mae || fim.filhas.length > 0) {
      throw new ConflictException(`A linha do banco ${idMae} continua no IXC. Confira lá.`);
    }
    return { apagados };
  }
}
