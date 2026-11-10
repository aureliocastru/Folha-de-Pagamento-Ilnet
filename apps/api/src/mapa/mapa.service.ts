import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RastreadorDoTecnico } from '@prisma/client';
import type { AppConfig } from '../config/configuration';
import { lerPorIds } from '../contabilidade/ixc-leitura';
import { IxcClient } from '../ixc/ixc.client';
import { OsDoIxcService } from '../os/os-do-ixc.service';
import { PrismaService } from '../prisma/prisma.service';
import { cacheComReserva, CachePorId, type CacheComReserva } from './cache';
import {
  veiculosDosGrupos,
  type EstadoDoVeiculo,
  type VeiculoNoMapa,
  type VinculoDoRastreador,
} from './frota';
import {
  assuntoForaDoMapa,
  entraNoMapa,
  idDoIxc,
  osNoMapa,
  temPosicaoPropria,
  type OsNoMapa,
} from './ordens';
import { RastreamentoClient } from './rastreamento.client';

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;

/** O que a tela precisa saber antes do primeiro dado. */
export interface ConfigDoMapa {
  centro: [number, number];
  zoom: number;
  /** Segundos entre uma atualização e outra. */
  intervalos: { frota: number; os: number };
  /** Cada fonte está configurada no servidor? */
  fontes: { ixc: boolean; rastreio: boolean };
  problemas: string[];
}

export interface OrdensDoMapa {
  ordens: OsNoMapa[];
  /** O que faltou e não impediu o mapa: os nomes dos técnicos, um cadastro. */
  avisos: string[];
}

export interface FrotaDoMapa {
  veiculos: VeiculoNoMapa[];
  avisos: string[];
}

/** Um colaborador do IXC (`funcionarios`), para escolher quem anda no carro. */
export interface TecnicoDoIxc {
  id: number;
  nome: string;
  ativo: boolean;
}

/** Uma ligação guardada, como a tela de Rastreadores a mostra. */
export interface VinculoNaTela {
  dispositivoId: string;
  nomeDoVeiculo: string | null;
  tecnicoIxcId: number | null;
  tecnicoNome: string | null;
  equipe: string | null;
  atualizadoPor: string | null;
  atualizadoEm: string;
}

export interface RastreadorNaTela {
  dispositivoId: string;
  nome: string;
  placa: string | null;
  grupo: string | null;
  estado: EstadoDoVeiculo;
  horario: string | null;
  vinculo: VinculoNaTela | null;
}

export interface RastreadoresDaTela {
  configurado: boolean;
  problemas: string[];
  /** A última leitura do rastreador falhou (o que veio é o dado anterior, se há). */
  erro: string | null;
  atualizadoEm: string | null;
  veiculos: RastreadorNaTela[];
  /** As ligações cujo aparelho não está entre os `veiculos`. */
  semAparelho: VinculoNaTela[];
  tecnicos: TecnicoDoIxc[];
  avisos: string[];
}

function motivo(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function vinculoNaTela(l: RastreadorDoTecnico): VinculoNaTela {
  return {
    dispositivoId: l.dispositivoId,
    nomeDoVeiculo: l.nomeDoVeiculo,
    tecnicoIxcId: l.tecnicoIxcId,
    tecnicoNome: l.tecnicoNome,
    equipe: l.equipe,
    atualizadoPor: l.atualizadoPor,
    atualizadoEm: l.updatedAt.toISOString(),
  };
}

/**
 * O mapa de serviço: as OS abertas do IXC e a frota do rastreador, no mesmo
 * mapa — o ILNET Service Map, que era um painel à parte, trazido para dentro.
 *
 * As duas leituras ficam guardadas por um pouco menos que o intervalo da tela
 * (`cacheComReserva`): dez pessoas com o mapa aberto são uma consulta só ao
 * IXC e ao rastreador. E se uma fonte cai, o mapa segue com o último dado bom,
 * dizendo de quando ele é.
 *
 * Só lê o IXC. Escrever, só a ligação de cada rastreador ao técnico, que é
 * desta casa.
 */
@Injectable()
export class MapaService {
  private readonly logger = new Logger(MapaService.name);
  private readonly cfg: AppConfig['mapa'];
  private readonly ixcCfg: AppConfig['ixc'];

  /** As OS do mapa, guardadas (ver a classe). */
  readonly ordens: CacheComReserva<OrdensDoMapa>;
  /** A frota, guardada (ver a classe). */
  readonly frota: CacheComReserva<FrotaDoMapa>;

  // Os cadastros que a OS aponta mudam pouco de uma leitura para a outra.
  private readonly clientes: CachePorId<Record<string, unknown>>;
  private readonly contratos: CachePorId<Record<string, unknown>>;
  private readonly logins: CachePorId<Record<string, unknown>>;
  private tecnicosGuardados: { em: number; porId: Map<number, TecnicoDoIxc> } | null = null;

  constructor(
    private readonly ixc: IxcClient,
    private readonly osDoIxc: OsDoIxcService,
    private readonly rastreio: RastreamentoClient,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<AppConfig['mapa']>('mapa');
    this.ixcCfg = config.getOrThrow<AppConfig['ixc']>('ixc');

    // Um pouco menos que o intervalo da tela: cada atualização dela pega dado
    // novo, e as telas abertas ao mesmo tempo dividem a consulta.
    this.ordens = cacheComReserva(this.cfg.intervalos.os * 900, () => this.lerOrdens());
    this.frota = cacheComReserva(this.cfg.intervalos.frota * 900, () => this.lerFrota());

    const porIds = (tabela: string) => async (ids: number[]) => {
      const linhas = await lerPorIds(this.ixc, tabela, `${tabela}.id`, ids);
      return new Map(linhas.map((l) => [idDoIxc(l.id) ?? 0, l] as const));
    };
    this.clientes = new CachePorId(10 * MINUTO, porIds('cliente'));
    this.contratos = new CachePorId(10 * MINUTO, porIds('cliente_contrato'));
    this.logins = new CachePorId(10 * MINUTO, porIds('radusuarios'));
  }

  private problemasDoIxc(): string[] {
    const problemas: string[] = [];
    if (!this.ixcCfg.host) problemas.push('IXC_HOST não definido');
    if (!this.ixcCfg.token) problemas.push('IXC_TOKEN não definido');
    return problemas;
  }

  configDaTela(): ConfigDoMapa {
    const ixc = this.problemasDoIxc();
    const rastreio = this.rastreio.problemas();
    return {
      centro: this.cfg.centro,
      zoom: this.cfg.zoom,
      intervalos: this.cfg.intervalos,
      fontes: { ixc: ixc.length === 0, rastreio: rastreio.length === 0 },
      problemas: [...ixc.map((p) => `IXC: ${p}`), ...rastreio.map((p) => `Rastreamento: ${p}`)],
    };
  }

  /** O rastreador está configurado no servidor? */
  get temRastreador(): boolean {
    return this.rastreio.configurado;
  }

  /**
   * Todas as OS não finalizadas que entram no mapa, com cliente, técnico,
   * assunto, cidade e posição resolvidos. O que falhar dos cadastros vira
   * aviso, e a OS aparece com o que se tem: sem o nome do cliente, ou na lista
   * "Sem localização".
   */
  private async lerOrdens(): Promise<OrdensDoMapa> {
    const avisos: string[] = [];
    const opcional = async <T>(nome: string, promessa: Promise<Map<number, T>>) => {
      try {
        return await promessa;
      } catch (e) {
        avisos.push(`${nome}: ${motivo(e)}`);
        return new Map<number, T>();
      }
    };

    const [linhas, assuntos] = await Promise.all([
      this.ixc.listAll<Record<string, unknown>>(
        'su_oss_chamado',
        {
          qtype: 'su_oss_chamado.status',
          query: 'F',
          oper: '!=',
          sortname: 'su_oss_chamado.id',
          sortorder: 'desc',
        },
        { pageSize: 1000, maxPages: 20 },
      ),
      // Os nomes dos assuntos vêm junto, e não depois: é por eles que algumas
      // OS ficam de fora (`assuntoForaDoMapa`), e a que fica de fora não
      // precisa ter o cliente lido. Esta leitura não falha: sem o IXC, volta o
      // que já estava guardado.
      this.osDoIxc.nomesDosAssuntos(),
    ]);
    const limite = this.cfg.osDias > 0 ? Date.now() - this.cfg.osDias * DIA : null;
    const abertas = linhas.filter(
      (l) =>
        entraNoMapa(l, { tipos: this.cfg.osTipos, limite }) &&
        !assuntoForaDoMapa(assuntos.get(idDoIxc(l.id_assunto) ?? 0)),
    );
    // Login e contrato só importam para a OS que não tem coordenada própria.
    const semPosicao = abertas.filter((l) => !temPosicaoPropria(l));
    const ids = (lista: Array<Record<string, unknown>>, campo: string) =>
      lista.map((l) => idDoIxc(l[campo])).filter((id): id is number => id !== null);

    const [clientes, contratos, logins, tecnicos] = await Promise.all([
      opcional('Clientes', this.clientes.obter(ids(abertas, 'id_cliente'))),
      opcional('Contratos', this.contratos.obter(ids(semPosicao, 'id_contrato_kit'))),
      opcional('Logins', this.logins.obter(ids(semPosicao, 'id_login'))),
      opcional('Técnicos', this.nomesDosTecnicos()),
    ]);

    const idsDasCidades = [
      ...new Set([...ids(abertas, 'id_cidade'), ...ids([...clientes.values()], 'cidade')]),
    ];
    const cidades = new Map<number, { nome: string; uf: string | null }>();
    // A primeira sozinha: ela lê a tabela de UFs, que as outras reaproveitam
    // em vez de cada uma ler a sua ao mesmo tempo.
    const [primeira, ...resto] = idsDasCidades;
    const lidas = primeira
      ? [await this.osDoIxc.cidade(primeira), ...(await Promise.all(resto.map((id) => this.osDoIxc.cidade(id))))]
      : [];
    lidas.forEach((c, i) => {
      if (c) cidades.set(idsDasCidades[i], c);
    });

    const ctx = { clientes, contratos, logins, assuntos, tecnicos, cidades };
    return {
      ordens: abertas.map((l) => osNoMapa(l, ctx)).filter((os): os is OsNoMapa => os !== null),
      avisos,
    };
  }

  /** Todos os veículos da conta do rastreador, com o técnico de cada um. */
  private async lerFrota(): Promise<FrotaDoMapa> {
    const [grupos, vinculos] = await Promise.all([this.rastreio.grupos(), this.vinculos()]);
    const avisos: string[] = [];
    let tecnicos = new Map<number, string>();
    if ([...vinculos.values()].some((v) => v.tecnicoIxcId)) {
      try {
        tecnicos = await this.nomesDosTecnicos();
      } catch (e) {
        // O nome guardado na ligação segura a tela enquanto o IXC não volta.
        avisos.push(`Técnicos: ${motivo(e)}`);
      }
    }
    return { veiculos: veiculosDosGrupos(grupos, vinculos, tecnicos), avisos };
  }

  private async vinculos(): Promise<Map<string, VinculoDoRastreador>> {
    const linhas = await this.prisma.rastreadorDoTecnico.findMany();
    return new Map(
      linhas.map((l) => [
        l.dispositivoId,
        { tecnicoIxcId: l.tecnicoIxcId, tecnicoNome: l.tecnicoNome, equipe: l.equipe },
      ]),
    );
  }

  /**
   * Os colaboradores do IXC. Guardados por dez minutos; se o IXC falha, fica
   * o que já estava guardado.
   *
   * A tabela traz CPF, salário e conta de banco de cada um: daqui só sai o
   * id, o nome e se está ativo.
   */
  private async tecnicosDoIxc(): Promise<Map<number, TecnicoDoIxc>> {
    if (this.tecnicosGuardados && Date.now() - this.tecnicosGuardados.em < 10 * MINUTO) {
      return this.tecnicosGuardados.porId;
    }
    try {
      const linhas = await this.ixc.listAll<Record<string, unknown>>(
        'funcionarios',
        {
          qtype: 'funcionarios.id',
          query: '0',
          oper: '>',
          sortname: 'funcionarios.id',
          sortorder: 'asc',
        },
        { pageSize: 500, maxPages: 4 },
      );
      const porId = new Map<number, TecnicoDoIxc>();
      for (const l of linhas) {
        const id = idDoIxc(l.id);
        const nome = String(l.funcionario ?? '').trim();
        if (id && nome) {
          porId.set(id, { id, nome, ativo: String(l.ativo ?? '').trim().toUpperCase() !== 'N' });
        }
      }
      this.tecnicosGuardados = { em: Date.now(), porId };
      return porId;
    } catch (e) {
      if (this.tecnicosGuardados) {
        this.logger.warn(`Sem os colaboradores do IXC; ficam os de antes (${motivo(e)}).`);
        return this.tecnicosGuardados.porId;
      }
      throw e;
    }
  }

  private async nomesDosTecnicos(): Promise<Map<number, string>> {
    const porId = await this.tecnicosDoIxc();
    return new Map([...porId].map(([id, t]) => [id, t.nome]));
  }

  /**
   * A tela de Rastreadores: cada veículo da conta do rastreador com a ligação
   * dele, as ligações de aparelhos que sumiram da conta, e os colaboradores
   * do IXC para escolher.
   */
  async rastreadores(): Promise<RastreadoresDaTela> {
    const problemas = this.rastreio.problemas();
    const avisos: string[] = [];
    const [linhas, tecnicos] = await Promise.all([
      this.prisma.rastreadorDoTecnico.findMany({ orderBy: { updatedAt: 'desc' } }),
      this.tecnicosDoIxc()
        .then((m) => [...m.values()])
        .catch((e: unknown) => {
          avisos.push(`Sem a lista de colaboradores do IXC: ${motivo(e)}`);
          return [] as TecnicoDoIxc[];
        }),
    ]);

    let veiculos: VeiculoNoMapa[] = [];
    let erro: string | null = null;
    let atualizadoEm: string | null = null;
    if (problemas.length === 0) {
      try {
        const frota = await this.frota();
        veiculos = frota.veiculos;
        erro = frota.erro;
        atualizadoEm = frota.atualizadoEm;
      } catch (e) {
        erro = motivo(e);
      }
    }

    const porAparelho = new Map(linhas.map((l) => [l.dispositivoId, vinculoNaTela(l)]));
    const naConta = new Set(veiculos.map((v) => v.id));
    return {
      configurado: problemas.length === 0,
      problemas,
      erro,
      atualizadoEm,
      veiculos: veiculos
        .map((v) => ({
          dispositivoId: v.id,
          nome: v.nome,
          placa: v.placa,
          grupo: v.grupo,
          estado: v.estado,
          horario: v.horario,
          vinculo: porAparelho.get(v.id) ?? null,
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })),
      semAparelho: linhas.filter((l) => !naConta.has(l.dispositivoId)).map(vinculoNaTela),
      tecnicos: tecnicos.sort(
        (a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'),
      ),
      avisos,
    };
  }

  /**
   * Liga o rastreador a um técnico (e a uma equipe). Os dois vazios desfazem a
   * ligação: não há o que guardar.
   */
  async vincular(
    dispositivoId: string,
    dados: { tecnicoIxcId?: number | null; equipe?: string | null; nomeDoVeiculo?: string | null },
    quem: string | null,
  ): Promise<VinculoNaTela | null> {
    const tecnicoIxcId = dados.tecnicoIxcId ?? null;
    const equipe = dados.equipe?.trim() || null;
    if (!tecnicoIxcId && !equipe) {
      await this.desvincular(dispositivoId);
      return null;
    }

    let tecnicoNome: string | null = null;
    if (tecnicoIxcId) {
      const tecnico = (await this.tecnicosDoIxc()).get(tecnicoIxcId);
      if (!tecnico) {
        throw new BadRequestException(`O colaborador ${tecnicoIxcId} não foi achado no IXC.`);
      }
      tecnicoNome = tecnico.nome;
    }

    const nomeDoVeiculo = dados.nomeDoVeiculo?.trim() || null;
    const salvo = await this.prisma.rastreadorDoTecnico.upsert({
      where: { dispositivoId },
      create: { dispositivoId, nomeDoVeiculo, tecnicoIxcId, tecnicoNome, equipe, atualizadoPor: quem },
      update: {
        // O nome de quando foi ligado só se troca por outro, nunca por nada.
        ...(nomeDoVeiculo ? { nomeDoVeiculo } : {}),
        tecnicoIxcId,
        tecnicoNome,
        equipe,
        atualizadoPor: quem,
      },
    });
    // A próxima leitura do mapa já sai com o técnico novo no carro.
    this.frota.invalidar();
    return vinculoNaTela(salvo);
  }

  async desvincular(dispositivoId: string): Promise<void> {
    await this.prisma.rastreadorDoTecnico.deleteMany({ where: { dispositivoId } });
    this.frota.invalidar();
  }
}
