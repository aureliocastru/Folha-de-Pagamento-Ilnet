import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import { numeroDoIxc } from './estoque.mapper';
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

  constructor(private readonly ixc: IxcClient) {}

  async listar(): Promise<AlmoxarifadoNaTela[]> {
    const [linhas, filiais] = await Promise.all([
      this.ixc.listAll<Record<string, unknown>>(
        'almox',
        { qtype: 'almox.id', query: '0', oper: '>', sortname: 'almox.id', sortorder: 'asc' },
        { pageSize: 200, maxPages: 5 },
      ),
      this.filiais(),
    ]);
    return linhas
      .map((a) => {
        const filialId = numeroDoIxc(a.id_filial);
        return {
          id: numeroDoIxc(a.id),
          descricao: String(a.descricao ?? '').trim() || `Almoxarifado ${numeroDoIxc(a.id)}`,
          filialId,
          filial: filiais.find((f) => f.id === filialId)?.nome ?? null,
          ativo: String(a.ativo ?? 'S').toUpperCase() !== 'N',
        };
      })
      .filter((a) => a.id > 0)
      .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
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

  private async um(id: number): Promise<AlmoxarifadoNaTela> {
    const achado = (await this.listar()).find((a) => a.id === id);
    if (!achado) {
      throw new BadRequestException('O almoxarifado não apareceu no IXC depois de gravar.');
    }
    return achado;
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
