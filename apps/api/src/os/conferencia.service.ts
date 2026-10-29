import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ConferenciaDeOs, Prisma } from '@prisma/client';
import { emParalelo } from '../almoxarifado/mover-tudo';
import { tipoPeloConteudo } from '../arquivos/data-url';
import { PrismaService } from '../prisma/prisma.service';
import {
  DIAS_NA_FILA,
  diaDoFechamento,
  ehDia,
  ehMotivo,
  ehRetirada,
  fotosDaOs,
  gpsDoFechamento,
  MOTIVOS_DE_PROBLEMA,
  motivoParaRecusarVeredito,
  pesoDosSinais,
  resumirConferencias,
  sinaisDaOs,
  situacaoDepois,
  somarDias,
  type AparelhoDaOs,
  type ConferenciaDoMes,
  type MaterialDaOs,
  type OsFechada,
  type PedidoDeConferencia,
  type Sinal,
} from './conferencia';
import { OsDoIxcService } from './os-do-ixc.service';
import {
  hojeNaData,
  type ArquivoDaOs,
  type AssuntoDoIxc,
  type ComodatoDoContrato,
  type Coordenada,
} from './os-ixc';
import type { Login } from './os.service';
import { TecnicosService } from './tecnicos.service';

/** Os avisos de uma OS valem isto na lista do dia; o detalhe relê sempre. */
const SINAIS_VALEM_MS = 10 * 60_000;

/** Quantas OS se leem do IXC ao mesmo tempo para montar a lista do dia. */
const OS_EM_PARALELO = 6;

/** Um dia da fila: quantas OS de campo fecharam, e quantas faltam conferir. */
export interface DiaDaFila {
  dia: string;
  total: number;
  conferidas: number;
  problemas: number;
  pendentes: number;
}

export interface FilaDaConferencia {
  /** Do mais novo para o mais antigo. */
  dias: DiaDaFila[];
  /** O dia mais antigo que ainda tem OS sem conferir — é onde a tela abre. */
  primeiroPendente: string | null;
  problemasAbertos: number;
}

/** O veredito, como a tela mostra. */
export interface ConferenciaNaTela {
  situacao: 'CONFERIDA' | 'PROBLEMA' | 'RESOLVIDA';
  teveProblema: boolean;
  motivo: string | null;
  motivoTexto: string | null;
  observacao: string | null;
  conferidaPor: string;
  conferidaEm: string;
  respostaDoTecnico: string | null;
  respondidaEm: string | null;
  resolucao: string | null;
  resolvidaPor: string | null;
  resolvidaEm: string | null;
}

/** Uma OS na lista do dia. */
export interface OsNaConferencia {
  id: number;
  protocolo: string | null;
  dia: string;
  fechamento: string | null;
  tecnicoIxcId: number;
  tecnico: string;
  cliente: string | null;
  assunto: string | null;
  contratoId: number;
  sinais: Sinal[];
  fotos: number;
  /** A OS não pôde ser lida do IXC para os avisos. */
  erroDeLeitura: string | null;
  conferencia: ConferenciaNaTela | null;
}

export interface DiaNaConferencia {
  dia: string;
  os: OsNaConferencia[];
}

/** Uma OS aberta na conferência: tudo o que o chefe precisa ver para decidir. */
export interface OsParaConferir extends OsNaConferencia {
  endereco: string | null;
  abertura: string | null;
  /** O que o atendimento escreveu ao abrir. */
  mensagem: string | null;
  /** O que o técnico escreveu ao fechar. */
  relatorio: string | null;
  arquivos: ArquivoDaOs[];
  aparelhos: AparelhoDaOs[];
  materiais: MaterialDaOs[];
  comodatoDoContrato: ComodatoDoContrato[];
  /** Onde o celular estava quando a OS fechou (a mensagem de status F). */
  fechamentoGps: (Coordenada & { em: string | null }) | null;
  /** O que foi anotado pelo celular daqui, se foi. */
  itensDoApp: Array<{ tipo: string; descricao: string; situacao: string }>;
}

/** Uma OS que voltou da conferência com problema. */
export interface ProblemaNaTela {
  osIxcId: number;
  dia: string;
  tecnicoIxcId: number;
  tecnico: string | null;
  cliente: string | null;
  assunto: string | null;
  motivo: string | null;
  motivoTexto: string | null;
  observacao: string | null;
  conferidaPor: string;
  conferidaEm: string;
  respostaDoTecnico: string | null;
  respondidaEm: string | null;
}

/** O que a leitura de uma OS para conferir traz do IXC. */
interface Leitura {
  assunto: AssuntoDoIxc | null;
  arquivos: ArquivoDaOs[];
  aparelhos: AparelhoDaOs[];
  comodatoDoContrato: ComodatoDoContrato[] | null;
  sinais: Sinal[];
}

/**
 * A conferência das OS fechadas, pelo chefe do almoxarifado.
 *
 * **A fila vem do IXC, e não do que passou pelo celular daqui.** Entra toda OS
 * fechada no dia por um técnico de campo — o que tem almoxarifado (van) —, do
 * jeito que fechou: pelo app do IXC, pelo atendimento ou por aqui. A OS de
 * escritório, de técnico sem van, fica de fora.
 *
 * **O sistema olha antes** (`sinaisDaOs`): sem foto, sem a assinatura que o
 * assunto exige, instalação sem aparelho, aparelho em outro contrato, retirada
 * não baixada.
 * As OS com aviso sobem na lista; quem decide se está certa é o chefe.
 *
 * **Aqui fica só o veredito.** Nada é escrito no IXC: a OS, as fotos e o
 * comodato são lidos de lá, na hora. A OS com problema volta para o técnico,
 * que vê no celular e responde; quem conferiu marca resolvida depois.
 */
@Injectable()
export class ConferenciaService {
  private readonly logger = new Logger(ConferenciaService.name);
  private readonly sinaisGuardados = new Map<number, { em: number; sinais: Sinal[]; fotos: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly doIxc: OsDoIxcService,
    private readonly tecnicos: TecnicosService,
  ) {}

  // -------------------------------------------------------------------------
  // O chefe do almoxarifado
  // -------------------------------------------------------------------------

  /** Os últimos dias, com quantas OS faltam conferir em cada um. */
  async fila(agora = new Date()): Promise<FilaDaConferencia> {
    const hoje = hojeNaData(agora);
    const inicio = somarDias(hoje, -(DIAS_NA_FILA - 1));
    const [fechadas, deCampo, problemasAbertos] = await Promise.all([
      this.doIxc.fechadasEntre(inicio, hoje),
      this.tecnicosDeCampo(),
      this.prisma.conferenciaDeOs.count({ where: { situacao: 'PROBLEMA' } }),
    ]);
    const doCampo = fechadas.filter((os) => deCampo.has(os.tecnicoId));
    const conferencias = await this.prisma.conferenciaDeOs.findMany({
      where: { osIxcId: { in: doCampo.map((os) => os.id) } },
      select: { osIxcId: true, situacao: true },
    });
    const situacao = new Map(conferencias.map((c) => [c.osIxcId, c.situacao]));

    const porDia = new Map<string, DiaDaFila>();
    for (let n = 0; n < DIAS_NA_FILA; n++) {
      const dia = somarDias(hoje, -n);
      porDia.set(dia, { dia, total: 0, conferidas: 0, problemas: 0, pendentes: 0 });
    }
    for (const os of doCampo) {
      const linha = porDia.get(diaDoFechamento(os) ?? '');
      if (!linha) continue;
      linha.total += 1;
      const s = situacao.get(os.id);
      if (s === 'PROBLEMA') linha.problemas += 1;
      else if (s) linha.conferidas += 1;
      else linha.pendentes += 1;
    }
    const dias = [...porDia.values()];
    const pendente = [...dias].reverse().find((d) => d.pendentes > 0);
    return { dias, primeiroPendente: pendente?.dia ?? null, problemasAbertos };
  }

  /** As OS de campo que fecharam num dia, com os avisos e a conferência de cada uma. */
  async doDia(dia: string): Promise<DiaNaConferencia> {
    if (!ehDia(dia)) throw new BadRequestException('O dia vem como AAAA-MM-DD.');
    const [fechadas, deCampo, nomesDosAssuntos] = await Promise.all([
      this.doIxc.fechadasEntre(dia, dia),
      this.tecnicosDeCampo(),
      this.doIxc.nomesDosAssuntos(),
    ]);
    const lista = fechadas.filter((os) => deCampo.has(os.tecnicoId));
    const ids = lista.map((os) => os.id);
    const [clientes, conferencias, foraDoIxc] = await Promise.all([
      this.doIxc.nomesDosClientes(lista.map((os) => os.clienteId)),
      this.prisma.conferenciaDeOs.findMany({ where: { osIxcId: { in: ids } } }),
      this.itensForaDoIxc(ids),
    ]);
    const conferenciaDe = new Map(conferencias.map((c) => [c.osIxcId, c]));

    const lidas = new Map<number, { sinais: Sinal[]; fotos: number; erro: string | null }>();
    await emParalelo(lista, OS_EM_PARALELO, async (os) => {
      const guardado = this.sinaisGuardados.get(os.id);
      if (guardado && Date.now() - guardado.em < SINAIS_VALEM_MS) {
        lidas.set(os.id, { ...guardado, erro: null });
        return;
      }
      try {
        const l = await this.ler(os, nomesDosAssuntos.get(os.assuntoId) ?? null, foraDoIxc.get(os.id) ?? 0);
        lidas.set(os.id, { sinais: l.sinais, fotos: fotosDaOs(l.arquivos).length, erro: null });
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Conferência: a OS ${os.id} não foi lida do IXC (${motivo}).`);
        lidas.set(os.id, { sinais: [], fotos: 0, erro: motivo });
      }
    });

    const naTela = lista.map((os) => {
      const l = lidas.get(os.id) ?? { sinais: [], fotos: 0, erro: null };
      return {
        ...this.resumo(os, deCampo, clientes, nomesDosAssuntos),
        sinais: l.sinais,
        fotos: l.fotos,
        erroDeLeitura: l.erro,
        conferencia: conferenciaNaTela(conferenciaDe.get(os.id) ?? null),
      };
    });
    return { dia, os: naTela.sort(naOrdemDaFila) };
  }

  /** Uma OS para conferir: lida agora do IXC, com tudo. */
  async daOs(osId: number): Promise<OsParaConferir> {
    const os = await this.doIxc.osFechada(osId);
    if (!os) throw new NotFoundException(`A OS ${osId} não foi achada no IXC.`);
    const dia = diaDoFechamento(os);
    if (os.status !== 'F' || !dia) throw new BadRequestException(`A OS ${osId} ainda não fechou no IXC.`);

    const [deCampo, nomesDosAssuntos, clientes, conferencia, registro] = await Promise.all([
      this.tecnicosDeCampo(),
      this.doIxc.nomesDosAssuntos(),
      this.doIxc.nomesDosClientes([os.clienteId]),
      this.prisma.conferenciaDeOs.findUnique({ where: { osIxcId: osId } }),
      this.prisma.registroDeOs.findUnique({
        where: { osIxcId: osId },
        select: { itens: { select: { tipo: true, descricao: true, situacao: true }, orderBy: { createdAt: 'asc' } } },
      }),
    ]);
    const itens = registro?.itens ?? [];
    const leitura = await this.ler(
      os,
      nomesDosAssuntos.get(os.assuntoId) ?? null,
      itens.filter((i) => i.situacao !== 'GRAVADO').length,
    );
    const [materiais, comodatoDoContrato, mensagens] = await Promise.all([
      this.doIxc.materiaisDetalhadosDaOs(osId),
      leitura.comodatoDoContrato ?? this.doIxc.comodatosDoContrato(os.contratoId),
      this.doIxc.mensagensDaOs(osId).catch(() => []),
    ]);

    return {
      ...this.resumo(os, deCampo, clientes, nomesDosAssuntos),
      sinais: leitura.sinais,
      fotos: fotosDaOs(leitura.arquivos).length,
      erroDeLeitura: null,
      conferencia: conferenciaNaTela(conferencia),
      endereco: os.endereco,
      abertura: os.abertura,
      mensagem: os.mensagem,
      relatorio: os.relatorio,
      arquivos: leitura.arquivos,
      aparelhos: leitura.aparelhos,
      materiais,
      comodatoDoContrato,
      fechamentoGps: gpsDoFechamento(mensagens),
      itensDoApp: itens.map((i) => ({ tipo: i.tipo, descricao: i.descricao, situacao: i.situacao })),
    };
  }

  /** A imagem de um arquivo da OS, do IXC — passa por aqui porque o token do IXC não sai do servidor. */
  async arquivo(arquivoId: number): Promise<{ tipo: string; conteudo: Buffer }> {
    const { tipo, conteudo } = await this.doIxc.conteudoDoArquivo(arquivoId);
    if (conteudo.length === 0) throw new NotFoundException('O IXC não devolveu esse arquivo.');
    // O tipo pelos primeiros bytes, quando eles dizem: o IXC às vezes declara
    // um e manda outro.
    return { tipo: tipoPeloConteudo(conteudo) ?? (tipo.split(';')[0] || 'application/octet-stream'), conteudo };
  }

  /**
   * O veredito do chefe. "Conferida" numa OS que estava com problema é o
   * problema resolvido — a observação vira a resolução, e o motivo fica, para
   * o relatório contar.
   */
  async conferir(osId: number, pedido: PedidoDeConferencia, quem: { nome: string }): Promise<ConferenciaNaTela> {
    const recusa = motivoParaRecusarVeredito(pedido);
    if (recusa) throw new BadRequestException(recusa);
    const os = await this.doIxc.osFechada(osId);
    if (!os) throw new NotFoundException(`A OS ${osId} não foi achada no IXC.`);
    const dia = diaDoFechamento(os);
    if (os.status !== 'F' || !dia) throw new BadRequestException(`A OS ${osId} ainda não fechou no IXC.`);

    const [deCampo, nomesDosAssuntos, clientes, antes] = await Promise.all([
      this.tecnicosDeCampo(),
      this.doIxc.nomesDosAssuntos(),
      this.doIxc.nomesDosClientes([os.clienteId]),
      this.prisma.conferenciaDeOs.findUnique({ where: { osIxcId: osId } }),
    ]);
    const { situacao, teveProblema } = situacaoDepois(antes, pedido.situacao);
    const observacao = pedido.observacao?.trim().slice(0, 1000) || null;
    const agora = new Date();
    const retrato = {
      dia,
      tecnicoIxcId: os.tecnicoId,
      tecnico: deCampo.get(os.tecnicoId) ?? antes?.tecnico ?? null,
      cliente: clientes.get(os.clienteId) ?? antes?.cliente ?? null,
      assunto: nomesDosAssuntos.get(os.assuntoId) ?? antes?.assunto ?? null,
      sinais: (this.sinaisGuardados.get(osId)?.sinais ?? undefined) as Prisma.InputJsonValue | undefined,
    };
    const veredito =
      situacao === 'PROBLEMA'
        ? {
            situacao,
            teveProblema,
            motivo: pedido.motivo ?? null,
            observacao,
            conferidaPor: quem.nome,
            conferidaEm: agora,
            // O problema de agora é outro: a resposta e a resolução de antes não valem.
            respostaDoTecnico: null,
            respondidaEm: null,
            resolucao: null,
            resolvidaPor: null,
            resolvidaEm: null,
          }
        : situacao === 'RESOLVIDA'
          ? { situacao, teveProblema, resolucao: observacao, resolvidaPor: quem.nome, resolvidaEm: agora }
          : {
              situacao,
              teveProblema,
              motivo: null,
              observacao,
              conferidaPor: quem.nome,
              conferidaEm: agora,
            };

    const salva = await this.prisma.conferenciaDeOs.upsert({
      where: { osIxcId: osId },
      create: {
        osIxcId: osId,
        conferidaPor: quem.nome,
        conferidaEm: agora,
        ...retrato,
        ...veredito,
      },
      update: { ...retrato, ...veredito },
    });
    this.logger.log(
      `${quem.nome} conferiu a OS ${osId}: ${situacao}` +
        (situacao === 'PROBLEMA' && pedido.motivo ? ` (${pedido.motivo})` : '') +
        '.',
    );
    return conferenciaNaTela(salva)!;
  }

  /** As OS com problema ainda aberto, de qualquer dia — a mais antiga primeiro. */
  async problemas(): Promise<ProblemaNaTela[]> {
    const linhas = await this.prisma.conferenciaDeOs.findMany({
      where: { situacao: 'PROBLEMA' },
      orderBy: [{ dia: 'asc' }, { osIxcId: 'asc' }],
    });
    return linhas.map(problemaNaTela);
  }

  /** As conferências de um mês ("AAAA-MM"), pelo dia em que a OS fechou. */
  async relatorio(competencia: string): Promise<ConferenciaDoMes> {
    if (!/^\d{4}-\d{2}$/.test(competencia)) throw new BadRequestException('O mês vem como AAAA-MM.');
    const linhas = await this.prisma.conferenciaDeOs.findMany({
      where: { dia: { startsWith: `${competencia}-` } },
      select: { tecnicoIxcId: true, tecnico: true, situacao: true, teveProblema: true, motivo: true },
    });
    return resumirConferencias(competencia, linhas);
  }

  // -------------------------------------------------------------------------
  // O técnico
  // -------------------------------------------------------------------------

  /** As OS deste técnico que voltaram da conferência com problema. */
  async doTecnico(login: Login): Promise<ProblemaNaTela[]> {
    const tecnico = await this.tecnicos.doLogin(login.id);
    const linhas = await this.prisma.conferenciaDeOs.findMany({
      where: { tecnicoIxcId: tecnico.ixcId, situacao: 'PROBLEMA' },
      orderBy: [{ dia: 'asc' }, { osIxcId: 'asc' }],
    });
    return linhas.map(problemaNaTela);
  }

  /** O técnico responde do celular o que fez (ou por que está certo). Quem conferiu decide depois. */
  async responder(login: Login, osId: number, texto: string): Promise<ProblemaNaTela> {
    const resposta = texto.trim().slice(0, 1000);
    if (resposta.length < 3) throw new BadRequestException('Escreva a resposta.');
    const tecnico = await this.tecnicos.doLogin(login.id);
    const conferencia = await this.prisma.conferenciaDeOs.findUnique({ where: { osIxcId: osId } });
    if (!conferencia || conferencia.tecnicoIxcId !== tecnico.ixcId) {
      throw new NotFoundException('Essa OS não voltou da conferência para você.');
    }
    if (conferencia.situacao !== 'PROBLEMA') {
      throw new BadRequestException('Essa OS não está mais com problema na conferência.');
    }
    const salva = await this.prisma.conferenciaDeOs.update({
      where: { osIxcId: osId },
      data: { respostaDoTecnico: resposta, respondidaEm: new Date() },
    });
    this.logger.log(`${login.nome} respondeu a conferência da OS ${osId}.`);
    return problemaNaTela(salva);
  }

  // -------------------------------------------------------------------------
  // Miudezas
  // -------------------------------------------------------------------------

  /** id do técnico no IXC → nome, só de quem tem almoxarifado (van): o técnico de campo. */
  private async tecnicosDeCampo(): Promise<Map<number, string>> {
    const lista = await this.tecnicos.lista();
    return new Map(
      lista.filter((t) => t.ixcId && t.almox.ok).map((t) => [t.ixcId as number, t.nome]),
    );
  }

  /** Quantos itens anotados pelo celular daqui ainda não estão no IXC, por OS. */
  private async itensForaDoIxc(ids: number[]): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    const registros = await this.prisma.registroDeOs.findMany({
      where: { osIxcId: { in: ids } },
      select: { osIxcId: true, itens: { select: { situacao: true } } },
    });
    return new Map(
      registros.map((r) => [r.osIxcId, r.itens.filter((i) => i.situacao !== 'GRAVADO').length]),
    );
  }

  /** Lê do IXC o que os avisos olham, e guarda os avisos para a lista do dia. */
  private async ler(os: OsFechada, nomeDoAssunto: string | null, itensForaDoIxc: number): Promise<Leitura> {
    const [assunto, arquivos, aparelhos, comodatoDoContrato] = await Promise.all([
      this.doIxc.assunto(os.assuntoId).catch(() => null),
      this.doIxc.arquivosDaOs(os.id),
      this.doIxc.aparelhosDaOs(os.id),
      ehRetirada(nomeDoAssunto) ? this.doIxc.comodatosDoContrato(os.contratoId) : Promise.resolve(null),
    ]);
    const sinais = sinaisDaOs({
      nomeDoAssunto,
      assunto,
      contratoId: os.contratoId,
      arquivos,
      aparelhos,
      comodatoDoContrato,
      itensForaDoIxc,
    });
    this.sinaisGuardados.set(os.id, { em: Date.now(), sinais, fotos: fotosDaOs(arquivos).length });
    return { assunto, arquivos, aparelhos, comodatoDoContrato, sinais };
  }

  private resumo(
    os: OsFechada,
    deCampo: Map<number, string>,
    clientes: Map<number, string>,
    assuntos: Map<number, string>,
  ): Pick<
    OsNaConferencia,
    'id' | 'protocolo' | 'dia' | 'fechamento' | 'tecnicoIxcId' | 'tecnico' | 'cliente' | 'assunto' | 'contratoId'
  > {
    return {
      id: os.id,
      protocolo: os.protocolo,
      dia: diaDoFechamento(os) ?? '',
      fechamento: os.fechamento,
      tecnicoIxcId: os.tecnicoId,
      tecnico: deCampo.get(os.tecnicoId) ?? `Técnico ${os.tecnicoId}`,
      cliente: clientes.get(os.clienteId) ?? null,
      assunto: assuntos.get(os.assuntoId) ?? null,
      contratoId: os.contratoId,
    };
  }
}

/**
 * A ordem da lista do dia: por técnico; dentro dele, a que falta conferir
 * antes, e entre essas a com problema antes da com atenção; no empate, a hora
 * em que fechou.
 */
function naOrdemDaFila(a: OsNaConferencia, b: OsNaConferencia): number {
  return (
    a.tecnico.localeCompare(b.tecnico, 'pt-BR') ||
    Number(!!a.conferencia) - Number(!!b.conferencia) ||
    pesoDosSinais(a.sinais) - pesoDosSinais(b.sinais) ||
    (a.fechamento ?? '').localeCompare(b.fechamento ?? '')
  );
}

function motivoTexto(motivo: string | null): string | null {
  if (!motivo) return null;
  return ehMotivo(motivo) ? MOTIVOS_DE_PROBLEMA[motivo] : motivo;
}

function conferenciaNaTela(c: ConferenciaDeOs | null): ConferenciaNaTela | null {
  if (!c) return null;
  return {
    situacao: c.situacao,
    teveProblema: c.teveProblema,
    motivo: c.motivo,
    motivoTexto: motivoTexto(c.motivo),
    observacao: c.observacao,
    conferidaPor: c.conferidaPor,
    conferidaEm: c.conferidaEm.toISOString(),
    respostaDoTecnico: c.respostaDoTecnico,
    respondidaEm: c.respondidaEm?.toISOString() ?? null,
    resolucao: c.resolucao,
    resolvidaPor: c.resolvidaPor,
    resolvidaEm: c.resolvidaEm?.toISOString() ?? null,
  };
}

function problemaNaTela(c: ConferenciaDeOs): ProblemaNaTela {
  return {
    osIxcId: c.osIxcId,
    dia: c.dia,
    tecnicoIxcId: c.tecnicoIxcId,
    tecnico: c.tecnico,
    cliente: c.cliente,
    assunto: c.assunto,
    motivo: c.motivo,
    motivoTexto: motivoTexto(c.motivo),
    observacao: c.observacao,
    conferidaPor: c.conferidaPor,
    conferidaEm: c.conferidaEm.toISOString(),
    respostaDoTecnico: c.respostaDoTecnico,
    respondidaEm: c.respondidaEm?.toISOString() ?? null,
  };
}
