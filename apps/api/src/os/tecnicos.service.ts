import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ehAlmoxDeRecolhidos,
  ehAlmoxForaDaCasa,
  numeroDoIxc,
} from '../almoxarifado/estoque.mapper';
import { ProdutosService } from '../almoxarifado/produtos.service';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import { VinculoDoLoginService } from '../usuarios/vinculo-do-login.service';
import { OsDoIxcService, type AparelhoNoAlmox } from './os-do-ixc.service';
import {
  colaboradorDoIxc,
  resolverAlmoxDoTecnico,
  type AlmoxDoTecnico,
  type CadastroLocal,
  type LigacaoDoIxc,
  type UsuarioDoIxc,
} from './tecnicos';

/**
 * Quanto valem os usuários do IXC e as ligações deles com almoxarifado. Muda
 * quando alguém cria a van de um técnico novo — raro, e o botão "Atualizar" da
 * tela de técnicos relê na hora.
 */
const VALE_MS = 5 * 60_000;

/** O técnico que está fazendo a OS, com o almoxarifado de onde o material dele sai. */
export interface TecnicoDaOs {
  funcionarioId: string;
  nome: string;
  ixcId: number;
  almox: { id: number; nome: string; filialId: number };
}

/** Um técnico na tela da base: com o almoxarifado dele, ou o que falta para ter um. */
export interface TecnicoNaLista {
  funcionarioId: string;
  nome: string;
  ixcId: number | null;
  almox: AlmoxDoTecnico;
  /** O almoxarifado foi fixado aqui, e não achado pelo IXC. */
  fixado: boolean;
}

/** A van de um técnico, lida agora do IXC. */
export interface VanNaTela {
  tecnico: { funcionarioId: string; nome: string; almox: { id: number; nome: string; filialId: number } };
  aparelhos: Array<
    AparelhoNoAlmox & { recolhido: { osIxcId: number; cliente: string | null; dias: number } | null }
  >;
  materiais: Array<{
    produtoId: number;
    descricao: string;
    unidade: string | null;
    saldo: number;
    noCatalogo: boolean;
  }>;
  lidoEm: string;
}

interface Quem {
  nome: string;
}

/**
 * Quem é o técnico de uma OS, e de que almoxarifado do IXC sai o material dele.
 *
 * O login leva ao cadastro (`VinculoDoLoginService`), o cadastro ao colaborador
 * do IXC (`ixcId`), e daí a regra de `tecnicos.ts` acha o almoxarifado. O
 * `ixcId` é também o `id_tecnico` das OS — é por ele que se sabe que uma OS é
 * deste técnico, e não de outro.
 */
@Injectable()
export class TecnicosService {
  private readonly logger = new Logger(TecnicosService.name);
  private guardado: { em: number; usuarios: UsuarioDoIxc[]; ligacoes: LigacaoDoIxc[] } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly produtos: ProdutosService,
    private readonly vinculos: VinculoDoLoginService,
    private readonly doIxc: OsDoIxcService,
  ) {}

  /** O técnico do login que entrou. Recusa quem não é técnico com almoxarifado. */
  async doLogin(usuarioId: string): Promise<TecnicoDaOs> {
    const colaborador = await this.vinculos.doLogin(usuarioId);
    if (!colaborador) {
      throw new ForbiddenException(
        'Seu login ainda não está ligado ao seu cadastro de funcionário, e sem isso não dá ' +
          'para saber quais OS são suas. Peça ao administrador para ligar, na tela de Usuários.',
      );
    }
    return this.doFuncionario(colaborador.id);
  }

  async doFuncionario(funcionarioId: string): Promise<TecnicoDaOs> {
    const pessoa = await this.pessoa(funcionarioId);
    if (!pessoa.ixcId) {
      throw new BadRequestException(
        `O cadastro de ${pessoa.nome} não está ligado a um colaborador do IXC — as OS de lá ` +
          'não têm como ser achadas.',
      );
    }
    const almox = await this.resolver(pessoa);
    if (!almox.ok) {
      throw new BadRequestException(`Sem o almoxarifado de ${pessoa.nome}: ${almox.motivo}`);
    }
    return {
      funcionarioId: pessoa.id,
      nome: pessoa.nome,
      ixcId: pessoa.ixcId,
      almox: { id: almox.almoxId, nome: almox.nome, filialId: almox.filialId },
    };
  }

  /**
   * Os técnicos, para a base: todo colaborador ativo com usuário no IXC (é o
   * que faz dele alguém que pega OS) ou com almoxarifado fixado aqui.
   */
  async lista(recarregar = false): Promise<TecnicoNaLista[]> {
    if (recarregar) this.guardado = null;
    const [pessoas, cadastros, doIxc, [, almoxarifados]] = await Promise.all([
      this.prisma.funcionario.findMany({
        where: { ativo: true, isentoIcms: true },
        select: {
          id: true,
          nome: true,
          apelido: true,
          cpfCnpj: true,
          ixcId: true,
          ativo: true,
          almoxFixado: { select: { almoxId: true, almoxarifado: true } },
        },
        orderBy: { nome: 'asc' },
      }),
      this.cadastrosComIxc(),
      this.lerDoIxc(),
      this.produtos.paraMovimentar(),
    ]);
    const comUsuario = new Set(doIxc.usuarios.filter((u) => u.ativo).map((u) => u.funcionarioId));

    return pessoas
      .map((p) => ({ ...p, ixcId: colaboradorDoIxc(p, cadastros) }))
      .filter((p) => p.almoxFixado || (p.ixcId && comUsuario.has(p.ixcId)))
      .map((p) => ({
        funcionarioId: p.id,
        nome: p.apelido || p.nome,
        ixcId: p.ixcId,
        fixado: !!p.almoxFixado,
        almox: resolverAlmoxDoTecnico({
          ixcId: p.ixcId ?? 0,
          fixado: p.almoxFixado
            ? { almoxId: p.almoxFixado.almoxId, nome: p.almoxFixado.almoxarifado }
            : null,
          usuarios: doIxc.usuarios,
          ligacoes: doIxc.ligacoes,
          almoxarifados,
        }),
      }));
  }

  /**
   * Fixa o almoxarifado do técnico — para quando o IXC não diz um só (dois
   * padrões, nenhum, o usuário sem colaborador). Tem de ser um que o sistema
   * enxerga e ativo, e não um dos que não são de técnico.
   */
  async fixar(funcionarioId: string, almoxId: number, quem: Quem): Promise<TecnicoNaLista> {
    const pessoa = await this.pessoa(funcionarioId);
    const [, almoxarifados] = await this.produtos.paraMovimentar();
    const almox = almoxarifados.find((a) => a.id === almoxId);
    if (!almox) {
      throw new BadRequestException(
        'O sistema não enxerga esse almoxarifado no IXC. Libere-o na aba Almoxarifados antes.',
      );
    }
    if (!almox.ativo) throw new BadRequestException(`"${almox.nome}" está desativado no IXC.`);
    if (ehAlmoxForaDaCasa(almox.nome) || ehAlmoxDeRecolhidos(almox.nome)) {
      throw new BadRequestException(`"${almox.nome}" não é almoxarifado de técnico.`);
    }
    await this.prisma.almoxDoTecnico.upsert({
      where: { funcionarioId },
      create: { funcionarioId, almoxId, almoxarifado: almox.nome, definidoPor: quem.nome },
      update: { almoxId, almoxarifado: almox.nome, definidoPor: quem.nome },
    });
    this.logger.log(`${quem.nome} fixou o almoxarifado de ${pessoa.nome} em "${almox.nome}" (#${almoxId}).`);
    return this.naLista(funcionarioId);
  }

  /** Volta a valer o que o IXC diz. */
  async desfixar(funcionarioId: string, quem: Quem): Promise<TecnicoNaLista> {
    const pessoa = await this.pessoa(funcionarioId);
    await this.prisma.almoxDoTecnico.deleteMany({ where: { funcionarioId } });
    this.logger.log(`${quem.nome} desfixou o almoxarifado de ${pessoa.nome}: vale o do IXC.`);
    return this.naLista(funcionarioId);
  }

  /**
   * O que está na van de um técnico agora, no IXC — a conferência de técnico
   * por técnico: os aparelhos na prateleira dele (e quais voltaram de cliente
   * e ainda não passaram pela base), o saldo de cada material, e o que está
   * negativo, que é material lançado sem ter saído de onde devia.
   */
  async van(funcionarioId: string): Promise<VanNaTela> {
    const tecnico = await this.doFuncionario(funcionarioId);
    const [aparelhos, saldos, recolhidos, catalogo, [unidades]] = await Promise.all([
      this.doIxc.aparelhosNoAlmox(tecnico.almox.id),
      this.doIxc.saldosNoAlmox(tecnico.almox.id),
      this.prisma.itemDeOs.findMany({
        where: {
          tipo: 'RETIRADO',
          situacao: 'GRAVADO',
          recebidoEm: null,
          patrimonioId: { not: null },
        },
        select: { patrimonioId: true, gravadoEm: true, registro: { select: { osIxcId: true, cliente: true } } },
      }),
      this.prisma.materialDeOs.findMany({ select: { produtoId: true } }),
      this.produtos.paraMovimentar(),
    ]);
    const cadastros = await this.produtos.cadastrosPorId([...saldos.keys()]);
    const noCatalogo = new Set(catalogo.map((m) => m.produtoId));
    const porPeca = new Map(recolhidos.map((r) => [r.patrimonioId, r]));
    const agora = Date.now();

    const materiais = [...saldos.entries()]
      .map(([produtoId, saldo]) => {
        const c = cadastros.get(produtoId);
        return {
          produtoId,
          descricao: String(c?.descricao ?? '').trim() || `Produto ${produtoId}`,
          unidade: unidades.find((u) => u.id === numeroDoIxc(c?.unidade))?.sigla ?? null,
          tipo: String(c?.tipo ?? '').trim().toUpperCase(),
          saldo: Math.round(saldo * 1000) / 1000,
          noCatalogo: noCatalogo.has(produtoId),
        };
      })
      // Patrimônio aparece peça por peça, na lista de aparelhos; zerado não é assunto.
      .filter((m) => m.tipo !== 'P' && m.tipo !== 'S' && m.saldo !== 0)
      .sort(
        (a, b) =>
          Number(b.saldo < 0) - Number(a.saldo < 0) ||
          Number(b.noCatalogo) - Number(a.noCatalogo) ||
          a.descricao.localeCompare(b.descricao, 'pt-BR'),
      )
      .map(({ tipo: _tipo, ...m }) => m);

    return {
      tecnico: { funcionarioId: tecnico.funcionarioId, nome: tecnico.nome, almox: tecnico.almox },
      aparelhos: aparelhos.map((a) => {
        const r = porPeca.get(a.patrimonioId);
        return {
          ...a,
          recolhido: r
            ? {
                osIxcId: r.registro.osIxcId,
                cliente: r.registro.cliente,
                dias: Math.floor((agora - (r.gravadoEm ?? new Date()).getTime()) / 86_400_000),
              }
            : null,
        };
      }),
      materiais,
      lidoEm: new Date().toISOString(),
    };
  }

  private async naLista(funcionarioId: string): Promise<TecnicoNaLista> {
    const pessoa = await this.pessoa(funcionarioId);
    return {
      funcionarioId: pessoa.id,
      nome: pessoa.nome,
      ixcId: pessoa.ixcId,
      fixado: !!pessoa.fixado,
      almox: await this.resolver(pessoa),
    };
  }

  private async resolver(pessoa: Pessoa): Promise<AlmoxDoTecnico> {
    const [doIxc, [, almoxarifados]] = await Promise.all([
      this.lerDoIxc(),
      this.produtos.paraMovimentar(),
    ]);
    return resolverAlmoxDoTecnico({
      ixcId: pessoa.ixcId ?? 0,
      fixado: pessoa.fixado,
      usuarios: doIxc.usuarios,
      ligacoes: doIxc.ligacoes,
      almoxarifados,
    });
  }

  private async pessoa(funcionarioId: string): Promise<Pessoa> {
    const p = await this.prisma.funcionario.findUnique({
      where: { id: funcionarioId },
      select: {
        id: true,
        nome: true,
        apelido: true,
        cpfCnpj: true,
        ixcId: true,
        ativo: true,
        almoxFixado: { select: { almoxId: true, almoxarifado: true } },
      },
    });
    if (!p) throw new NotFoundException('Funcionário não encontrado.');
    return {
      id: p.id,
      nome: p.apelido || p.nome,
      // O do cadastro, ou o do gêmeo que veio de `funcionarios` (ver `colaboradorDoIxc`).
      ixcId: p.ixcId ?? colaboradorDoIxc(p, await this.cadastrosComIxc()),
      fixado: p.almoxFixado
        ? { almoxId: p.almoxFixado.almoxId, nome: p.almoxFixado.almoxarifado }
        : null,
    };
  }

  /** Os cadastros daqui que têm o colaborador do IXC — onde se procura o gêmeo. */
  private cadastrosComIxc(): Promise<CadastroLocal[]> {
    return this.prisma.funcionario.findMany({
      where: { ixcId: { not: null } },
      select: { id: true, nome: true, cpfCnpj: true, ixcId: true, ativo: true },
    });
  }

  /**
   * Os usuários do IXC e as ligações deles com almoxarifado. Do usuário só sai
   * o id, o colaborador e se está ativo: o registro traz e-mail e dados de
   * acesso, e nada disso interessa aqui.
   */
  private async lerDoIxc(): Promise<{ usuarios: UsuarioDoIxc[]; ligacoes: LigacaoDoIxc[] }> {
    if (this.guardado && Date.now() - this.guardado.em < VALE_MS) return this.guardado;
    const [usuarios, ligacoes] = await Promise.all([
      this.ixc.listAll<Record<string, unknown>>(
        'usuarios',
        { qtype: 'usuarios.id', query: '0', oper: '>', sortname: 'usuarios.id', sortorder: 'asc' },
        { pageSize: 500, maxPages: 5 },
      ),
      this.ixc.listAll<Record<string, unknown>>(
        'almox_usuario',
        {
          qtype: 'almox_usuario.id',
          query: '0',
          oper: '>',
          sortname: 'almox_usuario.id',
          sortorder: 'asc',
        },
        { pageSize: 500, maxPages: 10 },
      ),
    ]);
    this.guardado = {
      em: Date.now(),
      usuarios: usuarios
        .map((u) => ({
          id: numeroDoIxc(u.id),
          funcionarioId: numeroDoIxc(u.funcionario),
          ativo: String(u.status ?? 'A').trim().toUpperCase() === 'A',
        }))
        .filter((u) => u.id > 0),
      ligacoes: ligacoes
        .map((l) => ({
          usuarioId: numeroDoIxc(l.id_usuario),
          almoxId: numeroDoIxc(l.id_almox),
          padrao: String(l.padrao_usuario ?? 'N').trim().toUpperCase() === 'S',
        }))
        .filter((l) => l.usuarioId > 0 && l.almoxId > 0),
    };
    return this.guardado;
  }
}

interface Pessoa {
  id: string;
  nome: string;
  ixcId: number | null;
  fixado: { almoxId: number; nome: string } | null;
}
