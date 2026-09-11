import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { IxcClient } from '../ixc/ixc.client';
import { numeroDoIxc } from './estoque.mapper';
import { EstoqueService } from './estoque.service';
import {
  montarEdicaoAlmoxarifado,
  montarEdicaoDoVinculo,
  montarNovoAlmoxarifado,
  montarVinculo,
  type EdicaoDoAlmoxarifado,
  type NovoAlmoxarifado,
} from './almoxarifados-ixc';

/** Um usuário do IXC ligado a um almoxarifado (a aba "Almoxarifados" do usuário). */
export interface UsuarioDoAlmoxarifado {
  id: number;
  nome: string;
  /** É o almoxarifado padrão desse usuário — o que a OS dele consome. */
  padrao: boolean;
}

/** Um almoxarifado como a tela de cadastro o mostra. */
export interface AlmoxarifadoNaTela {
  id: number;
  descricao: string;
  /** 0 quando o sistema não enxerga o cadastro (ver `liberado`). */
  filialId: number;
  filial: string | null;
  ativo: boolean;
  /**
   * O usuário do IXC que o sistema usa enxerga este almoxarifado. Sem isso o
   * IXC esconde o cadastro dele da API — não dá para editar, e a
   * transferência para ele é recusada. Resolve-se com `liberar()`.
   */
  liberado: boolean;
  /** Quem está ligado a ele no IXC — o técnico dono, quando é de técnico. */
  usuarios: UsuarioDoAlmoxarifado[];
}

interface Vinculo {
  id: number;
  usuarioId: number;
  almoxId: number;
  padrao: boolean;
}

interface Quem {
  nome: string;
}

/**
 * O cadastro de almoxarifados — no IXC.
 *
 * **No IXC, cada usuário só enxerga os almoxarifados ligados a ele** (Usuários
 * › aba Almoxarifados, a tabela `almox_usuario`). Vale para a tela de lá e
 * vale para o webservice: o `almox` só devolve os ligados ao usuário do token.
 * É assim que a casa organiza o técnico — o almoxarifado da van do CLEYSON
 * está ligado só ao usuário dele. Consequências, e o que se faz com cada uma:
 *
 *  - a listagem de `almox` vem incompleta. A lista daqui junta três fontes: o
 *    `almox` visível, os almoxarifados que aparecem no saldo e os ligados a
 *    algum usuário (`almox_usuario`);
 *  - um almoxarifado criado sem ligação nenhuma nasce invisível para todo
 *    mundo. Por isso `criar` já liga o novo ao usuário do sistema e a quem
 *    enxerga o almoxarifado principal;
 *  - para editar o de um técnico, o usuário do sistema precisa estar ligado a
 *    ele. `liberar` faz essa ligação (sem mexer no padrão de ninguém).
 */
@Injectable()
export class AlmoxarifadosService {
  private readonly logger = new Logger(AlmoxarifadosService.name);

  constructor(
    private readonly ixc: IxcClient,
    private readonly estoque: EstoqueService,
    private readonly config: ConfigService,
  ) {}

  async listar(): Promise<AlmoxarifadoNaTela[]> {
    const [visiveis, filiais, doSaldo, vinculos] = await Promise.all([
      this.visiveis(),
      this.filiais(),
      this.estoque.almoxarifadosConhecidos().catch((e: unknown) => {
        this.logger.warn(`Sem o saldo para completar os almoxarifados (${motivo(e)}).`);
        return [] as Array<{ id: number; nome: string }>;
      }),
      this.vinculos(),
    ]);
    const nomes = await this.nomesDeUsuarios(vinculos.map((v) => v.usuarioId));

    const porId = new Map<number, AlmoxarifadoNaTela>();
    for (const a of visiveis) {
      const linha = this.mapear(a, filiais);
      if (linha) porId.set(linha.id, linha);
    }
    const semAcesso = (id: number, nome?: string): AlmoxarifadoNaTela => ({
      id,
      descricao: nome || `Almoxarifado ${id}`,
      filialId: 0,
      filial: null,
      ativo: true,
      liberado: false,
      usuarios: [],
    });
    for (const s of doSaldo) {
      if (!porId.has(s.id)) porId.set(s.id, semAcesso(s.id, s.nome));
    }
    for (const v of vinculos) {
      if (!porId.has(v.almoxId)) porId.set(v.almoxId, semAcesso(v.almoxId));
    }

    for (const v of vinculos) {
      const almox = porId.get(v.almoxId);
      if (!almox || v.usuarioId === this.usuarioDoSistema()) continue;
      almox.usuarios.push({
        id: v.usuarioId,
        nome: nomes.get(v.usuarioId) ?? `Usuário ${v.usuarioId}`,
        padrao: v.padrao,
      });
    }

    return [...porId.values()].sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
  }

  /**
   * O que os formulários da tela precisam escolher: as filiais, os técnicos
   * (usuários ligados a um colaborador, para a van) e todos os usuários ativos
   * — estes para ligar alguém a um almoxarifado que já existe. O usuário do
   * sistema fica de fora: a ligação dele é a do botão "Liberar", e a tela não
   * o mostra entre os de quem o almoxarifado é.
   */
  async opcoes(): Promise<{
    filiais: Array<{ id: number; nome: string }>;
    tecnicos: Array<{ id: number; nome: string }>;
    usuarios: Array<{ id: number; nome: string }>;
  }> {
    const [filiais, doIxc] = await Promise.all([this.filiais(), this.usuariosDoIxc()]);
    const sistema = this.usuarioDoSistema();
    const usuarios = doIxc.filter((u) => u.id !== sistema);
    return {
      filiais,
      tecnicos: usuarios.filter((u) => u.tecnico).map(({ id, nome }) => ({ id, nome })),
      usuarios: usuarios.map(({ id, nome }) => ({ id, nome })),
    };
  }

  /**
   * Liga um usuário do IXC a este almoxarifado: é a ligação que o faz enxergá-lo
   * (a aba "Almoxarifados" do usuário, no IXC). Sem ela o almoxarifado não
   * aparece para a pessoa nem nas telas de lá.
   */
  async ligarUsuario(
    almoxId: number,
    usuarioId: number,
    padrao: boolean,
    quem: Quem,
  ): Promise<void> {
    const vinculos = await this.vinculos();
    const ja = vinculos.find((v) => v.almoxId === almoxId && v.usuarioId === usuarioId);
    if (ja) {
      if (ja.padrao || !padrao) {
        throw new BadRequestException('Esse usuário já está ligado a este almoxarifado.');
      }
      await this.definirPadrao(almoxId, usuarioId, true, quem);
      return;
    }
    await this.ixc.create('almox_usuario', montarVinculo(usuarioId, almoxId, padrao));
    if (padrao) await this.tirarPadraoDosOutros(usuarioId, almoxId, vinculos);
    this.logger.log(
      `${quem.nome} ligou o usuário ${usuarioId} ao almoxarifado #${almoxId} no IXC` +
        (padrao ? ', como o padrão dele' : '') +
        '.',
    );
  }

  /**
   * Tira a ligação — a pessoa deixa de enxergar o almoxarifado no IXC. O
   * usuário do sistema não sai por aqui: sem ele, esta tela perde o cadastro
   * de vista e não dá mais para editar nem transferir para ele.
   */
  async desligarUsuario(almoxId: number, usuarioId: number, quem: Quem): Promise<void> {
    if (usuarioId === this.usuarioDoSistema()) {
      throw new BadRequestException(
        'Esse é o usuário que o sistema usa no IXC. Tirando-o, o almoxarifado sumiria desta ' +
          'tela e não daria mais para editá-lo nem mandar material para ele.',
      );
    }
    const vinculo = (await this.vinculos()).find(
      (v) => v.almoxId === almoxId && v.usuarioId === usuarioId,
    );
    if (!vinculo) {
      throw new BadRequestException('Esse usuário já não está ligado a este almoxarifado.');
    }
    await this.ixc.remove('almox_usuario', vinculo.id);
    this.logger.log(
      `${quem.nome} tirou o usuário ${usuarioId} do almoxarifado #${almoxId} no IXC` +
        (vinculo.padrao ? ' (era o padrão dele)' : '') +
        '.',
    );
  }

  /**
   * Marca (ou desmarca) este almoxarifado como o padrão do usuário — é de onde
   * a OS dele tira material.
   *
   * **No IXC o padrão é do usuário, não do almoxarifado**: a marca vive na
   * ligação, e cada pessoa tem uma só. Por isso marcar aqui tira a marca das
   * outras ligações dela — senão ficariam dois padrões, e quem escolheria de
   * qual sai o material seria o IXC.
   */
  async definirPadrao(
    almoxId: number,
    usuarioId: number,
    padrao: boolean,
    quem: Quem,
  ): Promise<void> {
    const vinculos = await this.vinculos();
    const vinculo = vinculos.find((v) => v.almoxId === almoxId && v.usuarioId === usuarioId);
    if (!vinculo) {
      throw new BadRequestException(
        'Ligue o usuário a este almoxarifado antes de marcá-lo como o padrão dele.',
      );
    }
    if (vinculo.padrao !== padrao) await this.gravarPadrao(vinculo.id, padrao);
    if (padrao) await this.tirarPadraoDosOutros(usuarioId, almoxId, vinculos);
    this.logger.log(
      `${quem.nome} ${padrao ? 'marcou' : 'desmarcou'} o almoxarifado #${almoxId} como o ` +
        `padrão do usuário ${usuarioId} no IXC.`,
    );
  }

  /** O padrão é um só por pessoa: marcando um, os outros dela deixam de ser. */
  private async tirarPadraoDosOutros(
    usuarioId: number,
    almoxId: number,
    vinculos: Vinculo[],
  ): Promise<void> {
    for (const v of vinculos) {
      if (v.usuarioId === usuarioId && v.almoxId !== almoxId && v.padrao) {
        await this.gravarPadrao(v.id, false);
      }
    }
  }

  private async gravarPadrao(vinculoId: number, padrao: boolean): Promise<void> {
    const atual = await this.ixc.getById<Record<string, unknown>>(
      'almox_usuario',
      'almox_usuario.id',
      vinculoId,
    );
    if (!atual) {
      throw new BadRequestException('Essa ligação já não está no IXC — recarregue a tela.');
    }
    await this.ixc.update('almox_usuario', vinculoId, montarEdicaoDoVinculo(atual, padrao));
  }

  /**
   * Cria o almoxarifado e o liga a quem precisa enxergá-lo — é a ligação, e
   * não o cadastro, que o faz aparecer no IXC:
   *
   *  - o usuário do sistema, senão nem esta tela o acha depois;
   *  - quem já enxerga o almoxarifado principal (quem administra o estoque),
   *    para ele aparecer na tela de Almoxarifados do IXC dessas pessoas;
   *  - o técnico, quando é a van de um — como padrão dele se ele ainda não
   *    tem um (é o que a OS dele consome); se já tem, o padrão fica onde está.
   */
  async criar(dados: NovoAlmoxarifado, quem: Quem): Promise<AlmoxarifadoNaTela> {
    const sistema = this.exigirUsuarioDoSistema();
    const [vinculos, visiveis] = await Promise.all([this.vinculos(), this.visiveis()]);
    const ids = visiveis.map((a) => numeroDoIxc(a.id)).filter((id) => id > 0);
    const principal = ids.length > 0 ? Math.min(...ids) : 0;

    const ligar = new Map<number, boolean>([[sistema, false]]);
    for (const v of vinculos) if (v.almoxId === principal) ligar.set(v.usuarioId, false);
    const tecnico = dados.tecnicoUsuarioId;
    if (tecnico) {
      const jaTemPadrao = vinculos.some((v) => v.usuarioId === tecnico && v.padrao);
      ligar.set(tecnico, !jaTemPadrao);
    }

    const { id } = await this.ixc.create('almox', montarNovoAlmoxarifado(dados));
    if (!id) {
      throw new BadRequestException(
        'O IXC aceitou o cadastro mas não devolveu o código do almoxarifado novo. ' +
          'Confira no IXC antes de cadastrar de novo — ele pode ter sido criado.',
      );
    }
    for (const [usuarioId, padrao] of ligar) {
      await this.ixc.create('almox_usuario', montarVinculo(usuarioId, id, padrao));
    }
    this.logger.log(
      `${quem.nome} cadastrou o almoxarifado #${id} no IXC ("${dados.descricao}"), ` +
        `ligado aos usuários ${[...ligar.keys()].join(', ')}` +
        (tecnico ? ` (técnico ${tecnico}${ligar.get(tecnico) ? ', como padrão' : ''})` : '') +
        '.',
    );
    return this.um(id);
  }

  async editar(id: number, mudancas: EdicaoDoAlmoxarifado, quem: Quem): Promise<AlmoxarifadoNaTela> {
    await this.garantirAcesso([id]);
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
    await this.garantirAcesso([id]);
    const atual = await this.um(id);
    try {
      await this.ixc.remove('almox', id);
    } catch (err) {
      throw new BadRequestException(
        `O IXC não deixou apagar "${atual.descricao}" (${motivo(err)}). Isso acontece com ` +
          'almoxarifado que já teve produto ou movimento — desative-o em vez de apagar.',
      );
    }
    this.logger.log(`${quem.nome} apagou o almoxarifado #${id} ("${atual.descricao}") no IXC.`);
  }

  /**
   * Liga o usuário do sistema a todos os almoxarifados que ele ainda não
   * enxerga. Não mexe no padrão de ninguém (`padrao_usuario: "N"`) nem tira
   * ligação alguma — só acrescenta a do sistema.
   */
  async liberar(quem: Quem): Promise<{ liberados: number }> {
    const semAcesso = (await this.listar()).filter((a) => !a.liberado).map((a) => a.id);
    const liberados = await this.garantirAcesso(semAcesso);
    this.logger.log(`${quem.nome} liberou ${liberados} almoxarifado(s) para o sistema no IXC.`);
    return { liberados };
  }

  /** Liga o usuário do sistema aos almoxarifados dados, os que ainda não estão ligados. */
  private async garantirAcesso(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const sistema = this.exigirUsuarioDoSistema();
    const vinculos = await this.vinculos();
    const jaLigados = new Set(
      vinculos.filter((v) => v.usuarioId === sistema).map((v) => v.almoxId),
    );
    let feitos = 0;
    for (const id of ids) {
      if (jaLigados.has(id)) continue;
      await this.ixc.create('almox_usuario', montarVinculo(sistema, id));
      feitos += 1;
    }
    return feitos;
  }

  /**
   * O que ficou de um só, depois de criar ou editar — não a lista inteira de
   * novo, e direto pelo id.
   */
  private async um(id: number): Promise<AlmoxarifadoNaTela> {
    const [atual, filiais, vinculos] = await Promise.all([
      this.ixc.getById<Record<string, unknown>>('almox', 'almox.id', id),
      this.filiais(),
      this.vinculos(),
    ]);
    const linha = atual ? this.mapear(atual, filiais) : null;
    if (!linha) {
      throw new BadRequestException('O almoxarifado não apareceu no IXC depois de gravar.');
    }
    const daqui = vinculos.filter(
      (v) => v.almoxId === id && v.usuarioId !== this.usuarioDoSistema(),
    );
    const nomes = await this.nomesDeUsuarios(daqui.map((v) => v.usuarioId));
    linha.usuarios = daqui.map((v) => ({
      id: v.usuarioId,
      nome: nomes.get(v.usuarioId) ?? `Usuário ${v.usuarioId}`,
      padrao: v.padrao,
    }));
    return linha;
  }

  private async ler(id: number): Promise<Record<string, unknown>> {
    const atual = await this.ixc.getById<Record<string, unknown>>('almox', 'almox.id', id);
    if (!atual) throw new BadRequestException('Esse almoxarifado não existe no IXC.');
    return atual;
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
      liberado: true,
      usuarios: [],
    };
  }

  /** `almox` — só os que o usuário do sistema enxerga. */
  private visiveis(): Promise<Array<Record<string, unknown>>> {
    return this.ixc.listAll<Record<string, unknown>>(
      'almox',
      { qtype: 'almox.id', query: '0', oper: '>', sortname: 'almox.id', sortorder: 'asc' },
      { pageSize: 200, maxPages: 5 },
    );
  }

  /** `almox_usuario` — quem está ligado a qual. Falhar aqui não derruba a tela. */
  private async vinculos(): Promise<Vinculo[]> {
    try {
      const linhas = await this.ixc.listAll<Record<string, unknown>>(
        'almox_usuario',
        {
          qtype: 'almox_usuario.id',
          query: '0',
          oper: '>',
          sortname: 'almox_usuario.id',
          sortorder: 'asc',
        },
        { pageSize: 500, maxPages: 10 },
      );
      return linhas
        .map((l) => ({
          id: numeroDoIxc(l.id),
          usuarioId: numeroDoIxc(l.id_usuario),
          almoxId: numeroDoIxc(l.id_almox),
          padrao: String(l.padrao_usuario ?? 'N').toUpperCase() === 'S',
        }))
        .filter((v) => v.usuarioId > 0 && v.almoxId > 0);
    } catch (e) {
      this.logger.warn(`Sem os almoxarifados dos usuários do IXC (${motivo(e)}).`);
      return [];
    }
  }

  /**
   * id → nome dos usuários do IXC. Só o nome sai daqui: o registro de
   * usuário do IXC traz e-mail e dados de acesso, e nada disso interessa à
   * tela.
   */
  private async nomesDeUsuarios(ids: number[]): Promise<Map<number, string>> {
    const unicos = [...new Set(ids)].filter((id) => id > 0);
    const achados = await Promise.all(
      unicos.map((id) =>
        this.ixc
          .getById<Record<string, unknown>>('usuarios', 'usuarios.id', id)
          .catch(() => null),
      ),
    );
    const nomes = new Map<number, string>();
    achados.forEach((u, i) => {
      const nome = String(u?.nome ?? '').trim();
      if (nome) nomes.set(unicos[i], nome);
    });
    return nomes;
  }

  /**
   * Os usuários ativos do IXC, com a marca de quem é de um colaborador
   * (`usuarios.funcionario`, o mesmo campo do fluxo "Produtos do técnico" da
   * documentação) — é esse que ganha a van. Só id e nome saem daqui: o
   * registro de usuário traz e-mail e dados de acesso, e nada disso interessa
   * à tela.
   */
  private async usuariosDoIxc(): Promise<Array<{ id: number; nome: string; tecnico: boolean }>> {
    try {
      const linhas = await this.ixc.listAll<Record<string, unknown>>(
        'usuarios',
        { qtype: 'usuarios.id', query: '0', oper: '>', sortname: 'usuarios.id', sortorder: 'asc' },
        { pageSize: 500, maxPages: 5 },
      );
      return linhas
        .filter((u) => String(u.status ?? 'A').toUpperCase() === 'A')
        .map((u) => ({
          id: numeroDoIxc(u.id),
          nome: String(u.nome ?? '').trim(),
          tecnico: numeroDoIxc(u.funcionario) > 0,
        }))
        .filter((u) => u.id > 0 && u.nome !== '')
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    } catch (e) {
      this.logger.warn(`Sem a lista de usuários do IXC (${motivo(e)}).`);
      return [];
    }
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

  /**
   * O usuário do IXC que o sistema usa: o token do webservice é "id:hash", e
   * o id é o do usuário. 0 se o token não tiver esse formato.
   */
  private usuarioDoSistema(): number {
    const token = this.config.get<AppConfig['ixc']>('ixc')?.token ?? '';
    const id = Number(token.split(':')[0]);
    return Number.isInteger(id) && id > 0 ? id : 0;
  }

  private exigirUsuarioDoSistema(): number {
    const id = this.usuarioDoSistema();
    if (!id) {
      throw new BadRequestException(
        'Não deu para saber qual usuário do IXC o sistema usa (o token não está no formato ' +
          '"id:hash"). Sem ele, o almoxarifado ficaria invisível no IXC.',
      );
    }
    return id;
  }
}

function motivo(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
