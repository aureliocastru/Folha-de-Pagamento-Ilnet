import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type FinalizacaoDeOs, type RegistroDeOs, type SituacaoItemDeOs } from '@prisma/client';
import { createHash } from 'node:crypto';
import { conferirArquivo, extensaoDoTipo, lerDataUrl, type ArquivoRecebido } from '../arquivos/data-url';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import { OsDoIxcService } from './os-do-ixc.service';
import {
  CAMPO_DO_ARQUIVO_DA_OS,
  doSetor,
  mensagemDoFechamento,
  montarFechamento,
  montarFotoNaOs,
  STATUS_DA_OS,
  type AssuntoDoIxc,
  type OsDoIxc,
} from './os-ixc';
import {
  motivoDoAssunto,
  motivoDosItensTravados,
  motivoParaNaoFinalizar,
} from './os.regras';
import {
  FINALIZACAO_PARA_A_TELA,
  finalizacaoNaTela,
  nomeDoTecnico,
  OsService,
  type FinalizacaoNaTela,
  type Login,
  type ResultadoDaGravacao,
} from './os.service';

/** O que o passo a passo de finalizar precisa para abrir. */
export interface ParaFinalizar {
  /** O que o assunto da OS pede, do cadastro do IXC. */
  assunto: {
    nome: string;
    diagnosticoObrigatorio: boolean;
    aparelhosExigidos: number;
    produtosExigidos: number;
    /** Zero = não exige; o técnico põe quantas quiser, até o teto. */
    fotosExigidas: number;
  };
  /** Por que esta OS não se finaliza pelo celular — mostrado antes de preencher. */
  recusa: string | null;
  respostas: Array<{ id: number; nome: string; texto: string | null }>;
  diagnosticos: Array<{ id: number; nome: string }>;
  sugestao: {
    /** A resposta padrão de finalização do assunto. */
    respostaId: number | null;
    /** A hora da primeira anotação na OS, quando houve. ISO. */
    inicio: string | null;
  };
  /** A finalização já começada (pendente ou recusada), para preencher de novo. */
  finalizacao: FinalizacaoNaTela | null;
}

/** O que o técnico mandou. */
export interface PedidoDeFinalizacao {
  respostaId?: number;
  diagnosticoId?: number;
  relato: string;
  /** ISO. */
  inicio: string;
  gps?: { latitude: number; longitude: number; precisao?: number; em: string };
  /** Data URLs. Somam-se às que ficaram guardadas de uma tentativa anterior. */
  fotos?: string[];
}

/** O que a finalização fez: o envio dos itens que faltavam, e ela. */
export interface ResultadoDaFinalizacao {
  finalizacao: FinalizacaoNaTela;
  itens: ResultadoDaGravacao;
}

/** Igual aos itens: presa em GRAVANDO há mais que isto, alguém confere. */
const GRAVANDO_ESQUECIDO_MS = 10 * 60_000;

/** O que ainda pode ir ao IXC. */
const PODE_IR: SituacaoItemDeOs[] = ['PENDENTE', 'FALHOU'];

/** A foto sai do celular com menos de 1 MB; o teto daqui é a folga. */
const TIPOS_DE_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LIMITE_DA_FOTO = 3 * 1024 * 1024;

/**
 * Finalizar a OS pelo celular: o passo a passo do técnico, e a fila de levar
 * isso ao IXC.
 *
 * **O que cada OS pede vem do assunto no IXC** (resposta padrão, diagnóstico
 * obrigatório, aparelho ou produto exigido, quantas fotos): quem configura o
 * assunto lá configura a finalização daqui. O que o celular ainda não faz — a
 * equipe — se finaliza pelo IXC, e a tela diz isso antes de o técnico
 * preencher.
 *
 * **Finalizar é a última escrita da OS.** Primeiro vai o que ficou anotado
 * (`OsService.executar`); se algum item não for, a finalização espera, com o
 * motivo, e a base resolve. Depois as fotos, anexadas na OS. Só com tudo no
 * IXC vai o `su_oss_chamado_fechar`: depois de finalizada, o IXC pode recusar
 * o que faltava, e a troca ficaria pela metade.
 *
 * **À prova de repetição, como os itens.** PENDENTE/FALHOU → GRAVANDO por
 * troca condicional; o IXC que responde erro é relido antes de virar
 * "recusado" (a OS fechou mesmo assim?), e o que não dá para saber vai para a
 * base conferir.
 */
@Injectable()
export class FinalizacaoService {
  private readonly logger = new Logger(FinalizacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly doIxc: OsDoIxcService,
    private readonly os: OsService,
  ) {}

  // -------------------------------------------------------------------------
  // O técnico
  // -------------------------------------------------------------------------

  /** As listas e o que o assunto pede — o que o passo a passo mostra. */
  async paraFinalizar(login: Login, osId: number): Promise<ParaFinalizar> {
    const { os } = await this.os.contexto(login, osId);
    const [assunto, respostas, diagnosticos, registro] = await Promise.all([
      this.doIxc.assunto(os.assuntoId),
      this.doIxc.respostas(),
      this.doIxc.diagnosticos(),
      this.prisma.registroDeOs.findUnique({
        where: { osIxcId: os.id },
        include: {
          itens: { select: { createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 },
          finalizacao: { include: FINALIZACAO_PARA_A_TELA },
        },
      }),
    ]);
    const finalizacao = registro?.finalizacao ?? null;
    return {
      assunto: {
        nome: assunto.nome,
        diagnosticoObrigatorio: assunto.diagnosticoObrigatorio,
        aparelhosExigidos: assunto.aparelhosExigidos,
        produtosExigidos: assunto.produtosExigidos,
        fotosExigidas: assunto.fotosExigidas,
      },
      recusa:
        os.status === 'F'
          ? 'A OS já está finalizada no IXC.'
          : (motivoDaSituacao(finalizacao) ?? motivoDoAssunto(assunto)),
      respostas: doSetor(respostas, os.setorId).map(({ id, nome, texto }) => ({ id, nome, texto })),
      diagnosticos: doSetor(diagnosticos, os.setorId).map(({ id, nome }) => ({ id, nome })),
      sugestao: {
        respostaId: assunto.respostaPadraoId,
        inicio: registro?.itens[0]?.createdAt.toISOString() ?? null,
      },
      finalizacao: finalizacao ? finalizacaoNaTela(finalizacao) : null,
    };
  }

  /**
   * Finaliza a OS: confere o pedido contra o assunto e as listas do IXC,
   * guarda, e leva ao IXC. A finalização recusada antes (ou que esperava um
   * item) é refeita com o que veio agora — e as fotos de agora se somam às
   * que ficaram guardadas dela.
   */
  async finalizar(
    login: Login,
    osId: number,
    pedido: PedidoDeFinalizacao,
  ): Promise<ResultadoDaFinalizacao> {
    const { tecnico, os } = await this.os.contexto(login, osId);
    if (os.status === 'F') throw new BadRequestException('A OS já está finalizada no IXC.');

    const [assunto, respostas, diagnosticos, existente] = await Promise.all([
      this.doIxc.assunto(os.assuntoId),
      this.doIxc.respostas(),
      this.doIxc.diagnosticos(),
      this.prisma.registroDeOs.findUnique({
        where: { osIxcId: os.id },
        include: {
          itens: { select: { tipo: true, situacao: true } },
          finalizacao: { include: { fotos: { select: { hash: true } } } },
        },
      }),
    ]);
    const jaComecada = existente?.finalizacao ?? null;
    const naSituacao = motivoDaSituacao(jaComecada);
    if (naSituacao) throw new BadRequestException(naSituacao);

    const guardadas = jaComecada?.fotos ?? [];
    const jaTem = new Set(guardadas.map((f) => f.hash));
    const novas = lerFotos(pedido.fotos ?? []).filter((f) => !jaTem.has(f.hash));

    const respostaId = pedido.respostaId ?? null;
    const diagnosticoId = pedido.diagnosticoId ?? null;
    const inicio = new Date(pedido.inicio);
    const contagem = await this.contarExigidos(os, assunto, existente?.itens ?? []);
    const motivo = motivoParaNaoFinalizar({
      status: os.status,
      assunto,
      pedido: { respostaId, diagnosticoId, relato: pedido.relato, inicio },
      respostas,
      diagnosticos,
      ...contagem,
      fotos: guardadas.length + novas.length,
      abertura: os.abertura,
      agora: new Date(),
    });
    if (motivo) throw new BadRequestException(motivo);

    const gps = pedido.gps;
    const dados = {
      situacao: 'PENDENTE' as const,
      tecnicoId: tecnico.funcionarioId,
      tecnicoIxcId: tecnico.ixcId,
      respostaId,
      resposta: respostas.find((r) => r.id === respostaId)?.nome ?? null,
      diagnosticoId,
      diagnostico: diagnosticos.find((d) => d.id === diagnosticoId)?.nome ?? null,
      relato: pedido.relato.trim().slice(0, 2000),
      inicio,
      fim: new Date(),
      geraComissao: assunto.geraComissao,
      latitude: gps ? new Prisma.Decimal(gps.latitude.toFixed(7)) : null,
      longitude: gps ? new Prisma.Decimal(gps.longitude.toFixed(7)) : null,
      precisao: gps?.precisao !== undefined ? Math.round(gps.precisao) : null,
      gpsEm: gps ? new Date(gps.em) : null,
      erro: null,
      aviso: null,
      registradoPor: login.nome,
    };

    const registro = await this.os.registroDaOs(os);
    let finalizacaoId: string;
    if (jaComecada) {
      // Só se refaz a que ainda não foi: a troca condicional é a trava contra
      // o segundo toque, que chegaria com a primeira já em GRAVANDO.
      const { count } = await this.prisma.finalizacaoDeOs.updateMany({
        where: { id: jaComecada.id, situacao: { in: PODE_IR } },
        data: dados,
      });
      if (count === 0) throw new BadRequestException('A finalização desta OS já está indo ao IXC.');
      finalizacaoId = jaComecada.id;
    } else {
      try {
        ({ id: finalizacaoId } = await this.prisma.finalizacaoDeOs.create({
          data: { registroId: registro.id, ...dados },
        }));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new BadRequestException('A finalização desta OS já está indo ao IXC.');
        }
        throw err;
      }
    }
    if (novas.length > 0) {
      await this.prisma.fotoDaFinalizacao.createMany({
        data: novas.map((f, i) => {
          const ordem = guardadas.length + i + 1;
          return {
            finalizacaoId,
            ordem,
            nome: `os-${os.id}-foto-${ordem}.${extensaoDoTipo(f.tipo)}`,
            tipo: f.tipo,
            tamanho: f.conteudo.length,
            hash: f.hash,
            conteudo: new Uint8Array(f.conteudo),
          };
        }),
        // O toque repetido que passou pela trava acima traz as mesmas fotos.
        skipDuplicates: true,
      });
    }
    const comFotos = guardadas.length + novas.length;
    this.logger.log(
      `${login.nome} finalizou a OS ${os.id} pelo celular` +
        (comFotos > 0 ? `, com ${comFotos} foto(s).` : '.'),
    );

    const finalizacao = await this.prisma.finalizacaoDeOs.findUniqueOrThrow({
      where: { registroId: registro.id },
    });
    return this.levar(finalizacao, registro, os, { tecnicoId: tecnico.funcionarioId }, login.nome);
  }

  // -------------------------------------------------------------------------
  // A base
  // -------------------------------------------------------------------------

  /**
   * A base leva ao IXC a finalização que ficou para trás — o item recusado
   * que ela acertou, o sinal que caiu. Vão também os itens pendentes de
   * qualquer técnico, como no "Enviar ao IXC" da base.
   */
  async levarPelaBase(finalizacaoId: string, quem: { nome: string }): Promise<ResultadoDaFinalizacao> {
    const finalizacao = await this.prisma.finalizacaoDeOs.findUnique({
      where: { id: finalizacaoId },
      include: { registro: true },
    });
    if (!finalizacao) throw new NotFoundException('Finalização não encontrada.');
    if (!PODE_IR.includes(finalizacao.situacao)) {
      throw new BadRequestException('Essa finalização não está esperando envio.');
    }
    const os = await this.doIxc.os(finalizacao.registro.osIxcId);
    if (!os) {
      throw new BadRequestException(`A OS ${finalizacao.registro.osIxcId} não foi achada no IXC.`);
    }
    return this.levar(finalizacao, finalizacao.registro, os, {}, quem.nome);
  }

  /**
   * A finalização em "conferir": alguém olhou a OS no IXC e diz se ela fechou.
   * Fechou: vira gravada. Não fechou: volta a poder ir.
   */
  async resolverConferencia(
    finalizacaoId: string,
    fechou: boolean,
    quem: { nome: string },
  ): Promise<FinalizacaoNaTela> {
    const finalizacao = await this.prisma.finalizacaoDeOs.findUnique({ where: { id: finalizacaoId } });
    if (!finalizacao) throw new NotFoundException('Finalização não encontrada.');
    if (finalizacao.situacao !== 'CONFERIR') {
      throw new BadRequestException('Essa finalização não está esperando conferência.');
    }
    const atualizada = await this.prisma.finalizacaoDeOs.update({
      where: { id: finalizacaoId },
      data: fechou
        ? {
            situacao: 'GRAVADO',
            gravadoEm: finalizacao.gravadoEm ?? new Date(),
            aviso: juntar(finalizacao.aviso, `Conferido no IXC por ${quem.nome}: a OS fechou.`),
          }
        : {
            situacao: 'FALHOU',
            aviso: juntar(finalizacao.aviso, `Conferido no IXC por ${quem.nome}: a OS não fechou.`),
          },
      include: FINALIZACAO_PARA_A_TELA,
    });
    this.logger.log(
      `${quem.nome} conferiu no IXC a finalização ${finalizacaoId}: ${fechou ? 'fechou' : 'não fechou'}.`,
    );
    return finalizacaoNaTela(atualizada);
  }

  /** A base apaga a finalização que não foi — a OS que se fechou pelo IXC, por exemplo. */
  async descartar(finalizacaoId: string, quem: { nome: string }): Promise<void> {
    const { count } = await this.prisma.finalizacaoDeOs.deleteMany({
      where: { id: finalizacaoId, situacao: { in: PODE_IR } },
    });
    if (count === 0) {
      throw new BadRequestException(
        'Só sai daqui a finalização que não foi ao IXC. A que fechou a OS se desfaz no IXC (reabrindo a OS).',
      );
    }
    this.logger.log(`${quem.nome} descartou a finalização ${finalizacaoId}.`);
  }

  // -------------------------------------------------------------------------
  // Levar ao IXC
  // -------------------------------------------------------------------------

  /**
   * 1. **Os itens primeiro** — o que ficou anotado vai pelo caminho de sempre.
   *    Se algum não estiver no IXC depois disso, a finalização espera (PENDENTE,
   *    com o motivo) e nada se fecha.
   * 2. **Pega a finalização** — PENDENTE/FALHOU → GRAVANDO, por troca
   *    condicional. Quem não pegou devolve o que está lá.
   * 3. **Relê a OS** — já finalizada (pelo atendimento, ou por uma tentativa
   *    que respondeu erro e fechou) não se fecha de novo.
   * 4. **As fotos**, anexadas na OS. A que não for segura o fechamento: a
   *    finalização fica recusada, com o motivo, e vai de novo sem repetir as
   *    que já foram.
   * 5. **Fecha**, e relê: a OS tem de estar finalizada.
   */
  private async levar(
    finalizacao: FinalizacaoDeOs,
    registro: RegistroDeOs,
    os: OsDoIxc,
    filtro: { tecnicoId?: string },
    quem: string,
  ): Promise<ResultadoDaFinalizacao> {
    await this.esquecerInterrompidas();
    const itens = await this.os.executar(registro, os, filtro, quem);

    const fora = await this.prisma.itemDeOs.findMany({
      where: { registroId: registro.id, situacao: { not: 'GRAVADO' } },
      select: { situacao: true },
    });
    const travada = motivoDosItensTravados(fora);
    if (travada) {
      await this.prisma.finalizacaoDeOs.updateMany({
        where: { id: finalizacao.id, situacao: { in: PODE_IR } },
        data: { situacao: 'PENDENTE', erro: travada },
      });
      return { finalizacao: await this.naTela(finalizacao.id), itens };
    }

    const { count } = await this.prisma.finalizacaoDeOs.updateMany({
      where: { id: finalizacao.id, situacao: { in: PODE_IR } },
      data: { situacao: 'GRAVANDO', tentativas: { increment: 1 }, erro: null },
    });
    if (count === 0) return { finalizacao: await this.naTela(finalizacao.id), itens };

    let enviado = false;
    try {
      const atual = await this.doIxc.os(os.id);
      if (!atual) {
        await this.marcar(finalizacao.id, { situacao: 'FALHOU', erro: `A OS ${os.id} não foi achada no IXC.` });
        return { finalizacao: await this.naTela(finalizacao.id), itens };
      }
      // Também na OS que o atendimento fechou: a foto é do serviço, e é lá
      // que se vai procurá-la.
      const fotos = await this.enviarFotos(finalizacao.id, os.id);
      if (atual.status === 'F') {
        await this.marcar(finalizacao.id, {
          situacao: 'GRAVADO',
          gravadoEm: new Date(),
          aviso: juntar(
            'A OS já estava finalizada no IXC quando a finalização daqui foi enviada — o relato ' +
              'daqui não entrou nela.',
            fotos.erro,
          ),
        });
        return { finalizacao: await this.naTela(finalizacao.id), itens };
      }
      if (fotos.erro) {
        await this.marcar(finalizacao.id, {
          situacao: 'FALHOU',
          erro: `A OS não foi finalizada: ${fotos.erro} Mande de novo — as que já foram não vão duas vezes.`,
        });
        return { finalizacao: await this.naTela(finalizacao.id), itens };
      }

      const tecnico = await this.prisma.funcionario.findUnique({
        where: { id: finalizacao.tecnicoId },
        select: { nome: true, apelido: true },
      });
      const corpo = montarFechamento({
        osId: os.id,
        tecnicoIxcId: finalizacao.tecnicoIxcId,
        inicio: finalizacao.inicio,
        fim: finalizacao.fim,
        respostaId: finalizacao.respostaId,
        diagnosticoId: finalizacao.diagnosticoId,
        mensagem: mensagemDoFechamento(
          finalizacao.relato,
          tecnico ? nomeDoTecnico({ tecnico }) : finalizacao.registradoPor,
        ),
        geraComissao: finalizacao.geraComissao,
        gps:
          finalizacao.latitude !== null && finalizacao.longitude !== null
            ? {
                latitude: Number(finalizacao.latitude),
                longitude: Number(finalizacao.longitude),
                em: finalizacao.gpsEm ?? finalizacao.fim,
              }
            : null,
      });

      enviado = true;
      try {
        await this.ixc.action('su_oss_chamado_fechar', corpo);
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        const relida = await this.doIxc.os(os.id).catch(() => undefined);
        if (relida?.status === 'F') {
          this.logger.warn(`OS ${os.id}: o IXC respondeu erro ao fechar (${motivo}), mas a OS fechou.`);
          await this.marcar(finalizacao.id, {
            situacao: 'GRAVADO',
            gravadoEm: new Date(),
            aviso: `O IXC respondeu erro (${motivo}), mas relida a OS está finalizada.`,
          });
        } else if (relida) {
          await this.marcar(finalizacao.id, { situacao: 'FALHOU', erro: motivo });
        } else {
          await this.marcar(finalizacao.id, {
            situacao: 'CONFERIR',
            erro:
              `${motivo} — e relendo o IXC não deu para saber se a OS fechou. ` +
              'Confira lá antes de repetir.',
          });
        }
        return { finalizacao: await this.naTela(finalizacao.id), itens };
      }

      const relida = await this.doIxc.os(os.id).catch(() => null);
      const aviso = !relida
        ? 'O IXC aceitou o fechamento, mas a releitura da OS falhou. Confira no IXC se ela fechou.'
        : relida.status !== 'F'
          ? `O IXC aceitou o fechamento, mas relida a OS está "${STATUS_DA_OS[relida.status] ?? relida.status}". ` +
            'Confira no IXC.'
          : null;
      if (aviso) this.logger.warn(`OS ${os.id}: ${aviso}`);
      await this.marcar(finalizacao.id, { situacao: 'GRAVADO', gravadoEm: new Date(), aviso });
      this.logger.log(`${quem} fechou a OS ${os.id} no IXC.`);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.error(`OS ${os.id}: a finalização parou no meio (${motivo}).`);
      // Não chegou ao IXC: pode ir de novo. Chegou: alguém confere.
      await this.prisma.finalizacaoDeOs.updateMany({
        where: { id: finalizacao.id, situacao: 'GRAVANDO' },
        data: enviado
          ? { situacao: 'CONFERIR', erro: `A finalização parou no meio (${motivo}). Confira no IXC.` }
          : { situacao: 'FALHOU', erro: `Não foi ao IXC: ${motivo}` },
      });
      throw err;
    }
    return { finalizacao: await this.naTela(finalizacao.id), itens };
  }

  /**
   * O que a OS tem do que o assunto exige: no IXC, e anotado para ir antes do
   * fechamento. Só lê o IXC quando o assunto exige alguma coisa.
   */
  private async contarExigidos(
    os: OsDoIxc,
    assunto: AssuntoDoIxc,
    itens: Array<{ tipo: string; situacao: SituacaoItemDeOs }>,
  ): Promise<{ aparelhos: number; produtos: number }> {
    const aindaVao = (tipo: string) =>
      itens.filter((i) => i.tipo === tipo && PODE_IR.includes(i.situacao)).length;
    const [aparelhos, produtos] = await Promise.all([
      assunto.aparelhosExigidos > 0 ? this.doIxc.comodatosDaOs(os.id).then((l) => l.length) : 0,
      assunto.produtosExigidos > 0 ? this.doIxc.materiaisDaOs(os.id).then((l) => l.length) : 0,
    ]);
    return {
      aparelhos: aparelhos + aindaVao('INSTALADO'),
      produtos: produtos + aindaVao('MATERIAL'),
    };
  }

  /**
   * As fotos que ainda não foram, uma a uma e na ordem. A que vai deixa o
   * conteúdo para trás — mora na OS do IXC agora. A primeira que o IXC recusa
   * para a fila: com o IXC fora do ar, as outras iam esperar o mesmo erro.
   *
   * Não há releitura, como nos itens: a lista de arquivos da OS ainda não foi
   * vista nesta base, e a foto que foi apesar do erro só volta como uma cópia
   * a mais na OS — nada que mexa em estoque ou em dinheiro.
   */
  private async enviarFotos(
    finalizacaoId: string,
    osId: number,
  ): Promise<{ enviadas: number; erro: string | null }> {
    const fotos = await this.prisma.fotoDaFinalizacao.findMany({
      where: { finalizacaoId, enviadaEm: null },
      orderBy: { ordem: 'asc' },
    });
    let enviadas = 0;
    for (const foto of fotos) {
      if (!foto.conteudo) continue;
      try {
        await this.ixc.upload(
          'su_oss_chamado_arquivos',
          CAMPO_DO_ARQUIVO_DA_OS,
          { nome: foto.nome, tipo: foto.tipo, conteudo: Buffer.from(foto.conteudo) },
          montarFotoNaOs(osId, `Foto ${foto.ordem} — finalização pelo celular`),
        );
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        await this.prisma.fotoDaFinalizacao.update({ where: { id: foto.id }, data: { erro: motivo } });
        const faltam = fotos.length - enviadas;
        this.logger.warn(`OS ${osId}: ${faltam} foto(s) não foram ao IXC (${motivo}).`);
        return { enviadas, erro: `${faltam} foto(s) não foram à OS no IXC (${motivo}).` };
      }
      await this.prisma.fotoDaFinalizacao.update({
        where: { id: foto.id },
        data: { enviadaEm: new Date(), erro: null, conteudo: null },
      });
      enviadas++;
    }
    return { enviadas, erro: null };
  }

  /** Finalização esquecida em GRAVANDO (a API caiu no meio) vai para conferência. */
  private async esquecerInterrompidas(): Promise<void> {
    const { count } = await this.prisma.finalizacaoDeOs.updateMany({
      where: { situacao: 'GRAVANDO', updatedAt: { lt: new Date(Date.now() - GRAVANDO_ESQUECIDO_MS) } },
      data: {
        situacao: 'CONFERIR',
        erro: 'A finalização foi interrompida no meio. Confira no IXC se a OS fechou.',
      },
    });
    if (count > 0) this.logger.warn(`${count} finalização(ões) de OS presas em "gravando" foram para conferência.`);
  }

  private async marcar(id: string, data: Prisma.FinalizacaoDeOsUpdateInput): Promise<void> {
    await this.prisma.finalizacaoDeOs.update({ where: { id }, data });
  }

  private async naTela(id: string): Promise<FinalizacaoNaTela> {
    return finalizacaoNaTela(
      await this.prisma.finalizacaoDeOs.findUniqueOrThrow({ where: { id }, include: FINALIZACAO_PARA_A_TELA }),
    );
  }
}

/** A finalização que já foi (ou está indo) não se refaz pelo celular. */
function motivoDaSituacao(f: { situacao: SituacaoItemDeOs } | null): string | null {
  if (!f) return null;
  if (f.situacao === 'GRAVADO') return 'Esta OS já foi finalizada por aqui.';
  if (f.situacao === 'GRAVANDO') return 'A finalização desta OS está indo ao IXC agora.';
  if (f.situacao === 'CONFERIR') {
    return 'A finalização desta OS está esperando a base conferir no IXC se ela fechou.';
  }
  return null;
}

/**
 * As fotos do pedido, conferidas: imagem, abaixo do teto. A repetida no mesmo
 * pedido entra uma vez só.
 */
function lerFotos(dataUrls: string[]): Array<ArquivoRecebido & { hash: string }> {
  const vistas = new Set<string>();
  const fotos: Array<ArquivoRecebido & { hash: string }> = [];
  for (const url of dataUrls) {
    const arquivo = lerDataUrl(url);
    conferirArquivo(arquivo, TIPOS_DE_FOTO, LIMITE_DA_FOTO, 'A foto entra como JPEG, PNG ou WebP.');
    const hash = createHash('sha256').update(arquivo.conteudo).digest('hex');
    if (vistas.has(hash)) continue;
    vistas.add(hash);
    fotos.push({ ...arquivo, hash });
  }
  return fotos;
}

/** Junta avisos sem repetir e sem "null" no meio. */
function juntar(...partes: Array<string | null | undefined>): string | null {
  const vistas = [...new Set(partes.map((p) => (p ?? '').trim()).filter(Boolean))];
  return vistas.length ? vistas.join(' · ').slice(0, 1000) : null;
}
