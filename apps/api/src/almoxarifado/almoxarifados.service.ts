import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import { numeroDoIxc } from './estoque.mapper';
import { EstoqueService } from './estoque.service';
import {
  montarEdicaoAlmoxarifado,
  montarNovoAlmoxarifado,
  type EdicaoDoAlmoxarifado,
  type NovoAlmoxarifado,
} from './almoxarifados-ixc';

/** Um almoxarifado como a tela de cadastro o mostra. */
export interface AlmoxarifadoNaTela {
  id: number;
  descricao: string;
  filialId: number;
  /** Nulo se a filial do cadastro não existir mais no IXC. */
  filial: string | null;
  ativo: boolean;
}

interface Quem {
  nome: string;
}

/**
 * O cadastro de almoxarifados — no IXC.
 *
 * Não é o saldo (isso é `EstoqueService`, que lê `estoque_produtos_almox_
 * filial`): é a lista de **onde a casa guarda material** — a tabela `almox`
 * em si. Cadastrar um almoxarifado novo aqui é o mesmo que criar em Sistema
 * › Cadastros › Almoxarifados, só que sem trocar de sistema.
 */
@Injectable()
export class AlmoxarifadosService {
  private readonly logger = new Logger(AlmoxarifadosService.name);

  constructor(
    private readonly ixc: IxcClient,
    private readonly estoque: EstoqueService,
  ) {}

  /**
   * O `Almoxarifados (listar)` do IXC junto com o que a tela do Estoque já
   * mostrou — porque aquele, sozinho, não é confiável: visto em produção,
   * devolve só uma fatia dos almoxarifados que têm saldo de verdade (parece
   * um teto de página que o IXC aplica por conta própria, nesta instalação,
   * ignorando o `rp` pedido). Um almoxarifado com material dentro não pode
   * sumir da tela por causa disso — e quem lê `estoque_produtos_almox_filial`
   * (a `EstoqueService`) já paginou por completo e viu todos.
   *
   * Quem ficou de fora da listagem é buscado **um a um** (`getById`, que é
   * outra consulta — `oper: "=", rp: 1` — e não sofre do mesmo teto): quase
   * sempre acha, e o cadastro real completa a linha, filial e tudo. Só quando
   * nem assim aparece — de fato não está em `almox`, e o id ficou preso numa
   * linha velha do saldo — é que a linha entra com o aviso "não achado no
   * cadastro".
   */
  async listar(): Promise<AlmoxarifadoNaTela[]> {
    const [linhas, filiais, doSaldo] = await Promise.all([
      this.ixc.listAll<Record<string, unknown>>(
        'almox',
        { qtype: 'almox.id', query: '0', oper: '>', sortname: 'almox.id', sortorder: 'asc' },
        { pageSize: 200, maxPages: 5 },
      ),
      this.filiais(),
      this.estoque.almoxarifadosConhecidos().catch((e: unknown) => {
        this.logger.warn(
          `Sem o saldo para completar os almoxarifados (${e instanceof Error ? e.message : e}).`,
        );
        return [] as Array<{ id: number; nome: string }>;
      }),
    ]);

    const porId = new Map<number, AlmoxarifadoNaTela>();
    for (const a of linhas) {
      const linha = this.mapear(a, filiais);
      if (linha) porId.set(linha.id, linha);
    }

    const faltando = doSaldo.filter((s) => !porId.has(s.id));
    if (faltando.length > 0) {
      const achados = await Promise.all(
        faltando.map(async (s) => {
          try {
            const atual = await this.ixc.getById<Record<string, unknown>>(
              'almox',
              'almox.id',
              s.id,
            );
            return atual ? this.mapear(atual, filiais) : null;
          } catch {
            return null;
          }
        }),
      );
      faltando.forEach((s, i) => {
        const achado = achados[i];
        porId.set(
          s.id,
          achado ?? { id: s.id, descricao: s.nome, filialId: 0, filial: null, ativo: true },
        );
      });
    }

    return [...porId.values()].sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
  }

  private mapear(
    a: Record<string, unknown>,
    filiais: Array<{ id: number; nome: string }>,
  ): AlmoxarifadoNaTela | null {
    const id = numeroDoIxc(a.id);
    if (id <= 0) return null;
    const filialId = numeroDoIxc(a.id_filial);
    return {
      id,
      descricao: String(a.descricao ?? '').trim() || `Almoxarifado ${id}`,
      filialId,
      filial: filiais.find((f) => f.id === filialId)?.nome ?? null,
      ativo: String(a.ativo ?? 'S').toUpperCase() !== 'N',
    };
  }

  /** As filiais do IXC, para o formulário de cadastro. */
  async opcoes(): Promise<{ filiais: Array<{ id: number; nome: string }> }> {
    return { filiais: await this.filiais() };
  }

  async criar(dados: NovoAlmoxarifado, quem: Quem): Promise<AlmoxarifadoNaTela> {
    const { id } = await this.ixc.create('almox', montarNovoAlmoxarifado(dados));
    if (!id) {
      throw new BadRequestException(
        'O IXC aceitou o cadastro mas não devolveu o código do almoxarifado novo. ' +
          'Confira no IXC antes de cadastrar de novo — ele pode ter sido criado.',
      );
    }
    this.logger.log(`${quem.nome} cadastrou o almoxarifado #${id} no IXC ("${dados.descricao}").`);
    return this.um(id);
  }

  async editar(id: number, mudancas: EdicaoDoAlmoxarifado, quem: Quem): Promise<AlmoxarifadoNaTela> {
    const atual = await this.ler(id);
    await this.ixc.update('almox', id, montarEdicaoAlmoxarifado(atual, mudancas));
    this.logger.log(
      `${quem.nome} alterou o almoxarifado #${id} no IXC: ` + Object.keys(mudancas).join(', '),
    );
    return this.um(id);
  }

  /**
   * Apaga o almoxarifado no IXC. Ele pode recusar mesmo sem saldo nenhum —
   * almoxarifado que já teve produto, transferência ou comodato passando por
   * ele fica preso no histórico, e a mensagem sugere desativar em vez disso.
   */
  async apagar(id: number, quem: Quem): Promise<void> {
    const atual = await this.um(id);
    try {
      await this.ixc.remove('almox', id);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `O IXC não deixou apagar "${atual.descricao}" (${motivo}). Isso acontece com ` +
          'almoxarifado que já teve produto ou movimento — desative-o em vez de apagar.',
      );
    }
    this.logger.log(`${quem.nome} apagou o almoxarifado #${id} ("${atual.descricao}") no IXC.`);
  }

  /**
   * O que ficou de um só, depois de criar ou editar — não a lista inteira de
   * novo. Vai direto no `getById`: um recém-criado não tem saldo ainda (o
   * `estoque_produtos_almox_filial` não vai ajudar) e pode nem caber na
   * listagem truncada, dependendo de que id ganhou. É outra consulta, e ela
   * acha.
   */
  private async um(id: number): Promise<AlmoxarifadoNaTela> {
    const [atual, filiais] = await Promise.all([
      this.ixc.getById<Record<string, unknown>>('almox', 'almox.id', id),
      this.filiais(),
    ]);
    const linha = atual ? this.mapear(atual, filiais) : null;
    if (!linha) {
      throw new BadRequestException('O almoxarifado não apareceu no IXC depois de gravar.');
    }
    return linha;
  }

  private async ler(id: number): Promise<Record<string, unknown>> {
    const atual = await this.ixc.getById<Record<string, unknown>>('almox', 'almox.id', id);
    if (!atual) throw new BadRequestException('Esse almoxarifado não existe no IXC.');
    return atual;
  }

  private async filiais(): Promise<Array<{ id: number; nome: string }>> {
    const linhas = await this.ixc.listAll<Record<string, unknown>>(
      'filial',
      { qtype: 'filial.id', query: '0', oper: '>', sortname: 'filial.id', sortorder: 'asc' },
      { pageSize: 200, maxPages: 5 },
    );
    return linhas
      .map((f) => ({
        id: numeroDoIxc(f.id),
        nome: String(f.filial ?? f.razao_social ?? '').trim() || `Filial ${numeroDoIxc(f.id)}`,
      }))
      .filter((f) => f.id > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
}
