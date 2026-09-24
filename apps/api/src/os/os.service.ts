import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CondicaoDoRetirado,
  Prisma,
  SituacaoItemDeOs,
  TipoItemDeOs,
  type ItemDeOs,
  type RegistroDeOs,
} from '@prisma/client';
import { ComodatoService } from '../almoxarifado/comodato.service';
import { numeroDoIxc } from '../almoxarifado/estoque.mapper';
import { EstoqueService } from '../almoxarifado/estoque.service';
import { situacaoDaPeca } from '../almoxarifado/mover-tudo';
import { hojeParaIxc } from '../almoxarifado/produtos-ixc';
import { ProdutosService } from '../almoxarifado/produtos.service';
import { TransferenciasService, type PecaAchada } from '../almoxarifado/transferencias.service';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import { OsDoIxcService, type AparelhoNoAlmox } from './os-do-ixc.service';
import {
  montarBaixaDeComodato,
  montarComodatoNaOs,
  montarMaterialNaOs,
  osRecusaMaterial,
  STATUS_DA_OS,
  type ComodatoDoContrato,
  type OsDoIxc,
  type OsParaEscrever,
  type ProdutoParaOs,
} from './os-ixc';
import {
  motivoForaDosAparelhos,
  motivoParaNaoGastar,
  motivoParaNaoInstalar,
  motivoParaNaoRetirar,
  naOrdemDeGravar,
  type ItemJaAnotado,
} from './os.regras';
import { TecnicosService, type TecnicoDaOs } from './tecnicos.service';

/** Quem está pedindo: o login. */
export interface Login {
  id: string;
  nome: string;
}

/** Um item como as telas o mostram. */
export interface ItemNaTela {
  id: string;
  tipo: TipoItemDeOs;
  situacao: SituacaoItemDeOs;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  valorUnitario: number | null;
  patrimonioId: number | null;
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
  comodatoIxcId: number | null;
  movimentoIxcId: number | null;
  condicao: CondicaoDoRetirado | null;
  observacao: string | null;
  erro: string | null;
  aviso: string | null;
  tentativas: number;
  gravadoEm: string | null;
  recebidoEm: string | null;
  recebidoPor: string | null;
  destinoAlmox: string | null;
  tecnico: string;
  almoxarifado: string;
  registradoPor: string;
  criadoEm: string;
}

/** Uma OS do técnico, na lista dele. */
export interface OsNaLista {
  id: number;
  protocolo: string | null;
  status: string;
  statusNome: string;
  assunto: string | null;
  cliente: string | null;
  endereco: string | null;
  abertura: string | null;
  agenda: string | null;
  /** Por que a OS não aceita material por aqui (finalizada há dias). */
  recusa: string | null;
  anotados: number;
  pendentes: number;
  problemas: number;
}

/** A OS aberta no celular: tudo o que o técnico escolhe, e o que já anotou. */
export interface OsAberta {
  os: OsNaLista & { mensagem: string | null; contratoId: number; clienteId: number };
  tecnico: { nome: string; almox: { id: number; nome: string } };
  /** O que está em comodato no contrato — para marcar o que foi retirado. */
  paraRetirar: Array<ComodatoDoContrato & { produto: string; motivo: string | null }>;
  /** Os aparelhos de cliente na prateleira da van — para tocar em vez de bipar. */
  paraInstalar: Array<AparelhoNoAlmox & { motivo: string | null }>;
  /** A base ainda não marcou nenhum modelo como aparelho: nada se instala. */
  semListaDeAparelhos: boolean;
  /** O catálogo de materiais, com o que ele tem de cada um. */
  materiais: Array<{
    produtoId: number;
    descricao: string;
    unidade: string | null;
    saldo: number;
    /** O saldo menos o que está anotado e ainda não foi ao IXC. */
    livre: number;
    maximoPorOs: number | null;
    jaNestaOs: number;
  }>;
  itens: ItemNaTela[];
}

/** O pedido de um item novo. */
export interface PedidoDeItem {
  tipo: 'INSTALADO' | 'RETIRADO' | 'MATERIAL' | 'DIVERGENCIA';
  codigo?: string;
  patrimonioId?: number;
  comodatoId?: number;
  condicao?: CondicaoDoRetirado;
  produtoId?: number;
  quantidade?: number;
  descricao?: string;
  observacao?: string;
}

/** O que uma gravação fez — para a tela dizer em uma linha. */
export interface ResultadoDaGravacao {
  gravados: number;
  falharam: number;
  conferir: number;
  avisos: number;
}

/**
 * Item preso em GRAVANDO há mais que isto foi interrompido no meio (a API
 * reiniciou, a conexão com o IXC caiu sem resposta). Não se sabe se foi: vai
 * para CONFERIR, e ninguém o repete às cegas.
 */
const GRAVANDO_ESQUECIDO_MS = 10 * 60_000;

/** O que ainda vai (ou pode ir) ao IXC. */
const AINDA_VAI: SituacaoItemDeOs[] = ['PENDENTE', 'GRAVANDO', 'FALHOU', 'CONFERIR'];

const COM_REGISTRO = { registro: { select: { osIxcId: true, cliente: true } } } as const;
const PARA_A_TELA = { tecnico: { select: { nome: true, apelido: true } } } as const;

type ItemComTecnico = ItemDeOs & { tecnico: { nome: string; apelido: string | null } };

/**
 * A ordem de serviço no celular do técnico: o aparelho que ele instalou, o que
 * retirou e o material que gastou — anotados aqui e gravados na OS do IXC.
 *
 * **Anotar e gravar são dois passos**, de propósito. Anotar confere tudo contra
 * o IXC (a peça está na van dele? o comodato é deste contrato? tem conector
 * que chegue?) e guarda aqui; gravar leva ao IXC. No meio fica o que a rua
 * precisa: o sinal que cai no poste, a troca que se desfaz, a revisão antes
 * de mexer no estoque de verdade.
 *
 * **Gravar é à prova de repetição.** Cada item passa de PENDENTE para GRAVANDO
 * por uma troca condicional no banco — só quem a fez grava, mesmo com dois
 * toques no botão ou duas instâncias da API. E o que o IXC recusa é relido
 * antes de virar "falhou": o IXC já respondeu erro tendo gravado (ver
 * `docs/ixc/README.md`), e repetir às cegas tiraria duas vezes da van.
 */
@Injectable()
export class OsService {
  private readonly logger = new Logger(OsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly doIxc: OsDoIxcService,
    private readonly tecnicos: TecnicosService,
    private readonly transferencias: TransferenciasService,
    private readonly produtos: ProdutosService,
    private readonly estoque: EstoqueService,
    private readonly comodato: ComodatoService,
  ) {}

  // -------------------------------------------------------------------------
  // A tela do técnico
  // -------------------------------------------------------------------------

  /** As OS do técnico que entrou, e o que ele já anotou em cada uma. */
  async minhas(login: Login): Promise<{
    tecnico: { nome: string; almox: { id: number; nome: string } };
    os: OsNaLista[];
  }> {
    const tecnico = await this.tecnicos.doLogin(login.id);
    const lista = await this.doIxc.doTecnico(tecnico.ixcId);
    const [assuntos, clientes, contagens] = await Promise.all([
      this.doIxc.nomesDosAssuntos(),
      this.doIxc.nomesDosClientes(lista.map((o) => o.clienteId)),
      this.contagens(lista.map((o) => o.id)),
    ]);
    const agora = new Date();
    const os = lista
      .map((o) => naLista(o, assuntos, clientes, contagens.get(o.id), agora))
      .sort(
        (a, b) =>
          Number(!!a.recusa) - Number(!!b.recusa) ||
          (b.agenda ?? b.abertura ?? '').localeCompare(a.agenda ?? a.abertura ?? ''),
      );
    return { tecnico: { nome: tecnico.nome, almox: tecnico.almox }, os };
  }

  /** Uma OS aberta: o que dá para retirar, instalar e gastar, e o que já está anotado. */
  async abrir(login: Login, osId: number): Promise<OsAberta> {
    const { tecnico, os } = await this.contexto(login, osId);
    await this.esquecerInterrompidos();

    const [assuntos, clientes, comodatos, naVan, saldos, lista, registro] =
      await Promise.all([
        this.doIxc.nomesDosAssuntos(),
        this.doIxc.nomesDosClientes([os.clienteId]),
        this.doIxc.comodatosDoContrato(os.contratoId),
        this.doIxc.aparelhosNoAlmox(tecnico.almox.id),
        this.doIxc.saldosNoAlmox(tecnico.almox.id),
        this.prisma.materialDeOs.findMany({
          where: { ativo: true },
          orderBy: [{ ordem: 'asc' }, { descricao: 'asc' }],
        }),
        this.prisma.registroDeOs.findUnique({
          where: { osIxcId: os.id },
          include: { itens: { include: PARA_A_TELA, orderBy: { createdAt: 'asc' } } },
        }),
      ]);
    const itens = registro?.itens ?? [];
    const catalogo = lista.filter((m) => !m.aparelho);
    // Da van, só o que é aparelho de cliente: a escada e a caneta de limpeza
    // também são patrimônio, e não se instalam em ninguém.
    const modelos = new Set(lista.filter((m) => m.aparelho).map((m) => m.produtoId));
    const aparelhos = naVan.filter((a) => modelos.has(a.produtoId));

    // O que está anotado, em qualquer OS, das peças e comodatos que aparecem aqui.
    const [daspecas, doscomodatos, pendentesDeMaterial] = await Promise.all([
      this.anotadosDasPecas(aparelhos.map((a) => a.patrimonioId)),
      this.anotadosDosComodatos(comodatos.map((c) => c.comodatoId)),
      this.materialAindaNaoGravado(tecnico.almox.id),
    ]);
    const nomes = await this.nomesDosProdutos(comodatos.map((c) => c.produtoId));

    return {
      os: {
        ...naLista(os, assuntos, clientes, contar(itens), new Date()),
        mensagem: os.mensagem,
        contratoId: os.contratoId,
        clienteId: os.clienteId,
      },
      tecnico: { nome: tecnico.nome, almox: tecnico.almox },
      paraRetirar: comodatos.map((c) => ({
        ...c,
        produto: nomes.get(c.produtoId) ?? c.descricao ?? `Produto ${c.produtoId}`,
        motivo: motivoParaNaoRetirar(c, doscomodatos),
      })),
      paraInstalar: aparelhos.map((a) => ({
        ...a,
        motivo: motivoParaNaoInstalar(
          {
            patrimonioId: a.patrimonioId,
            descricao: a.descricao,
            almoxId: tecnico.almox.id,
            almoxarifado: tecnico.almox.nome,
            situacao: 'disponível',
            podeMover: true,
            impedimento: null,
          },
          tecnico.almox,
          daspecas.filter((i) => i.patrimonioId === a.patrimonioId),
        ),
      })),
      semListaDeAparelhos: modelos.size === 0,
      materiais: catalogo.map((m) => {
        const saldo = saldos.get(m.produtoId) ?? 0;
        const pendentes = pendentesDeMaterial.get(m.produtoId) ?? 0;
        return {
          produtoId: m.produtoId,
          descricao: m.descricao,
          unidade: m.unidade,
          saldo,
          livre: arredondar(saldo - pendentes),
          maximoPorOs: m.maximoPorOs === null ? null : Number(m.maximoPorOs),
          jaNestaOs: somar(
            itens.filter((i) => i.tipo === 'MATERIAL' && i.produtoId === m.produtoId),
          ),
        };
      }),
      itens: itens.map(naTela),
    };
  }

  /**
   * O aparelho de um código bipado — e se ele pode ser instalado por este
   * técnico. Não anota nada: é a pergunta antes do "instalar".
   */
  async procurarAparelho(
    login: Login,
    osId: number,
    codigo: string,
  ): Promise<{ peca: PecaAchada; motivo: string | null }> {
    const { tecnico } = await this.contexto(login, osId);
    const peca = await this.transferencias.acharPeca(codigo);
    const [anotados, aparelhos] = await Promise.all([
      this.anotadosDasPecas([peca.patrimonioId]),
      this.listaDeAparelhos(),
    ]);
    return {
      peca,
      motivo:
        motivoForaDosAparelhos(peca.produtoId, peca.descricao, aparelhos) ??
        motivoParaNaoInstalar(peca, tecnico.almox, anotados),
    };
  }

  /** Anota um item na OS. Confere tudo contra o IXC agora; não escreve lá. */
  async anotar(login: Login, osId: number, pedido: PedidoDeItem): Promise<ItemNaTela> {
    const { tecnico, os } = await this.contexto(login, osId);
    const recusa = osRecusaMaterial(os);
    if (recusa) throw new BadRequestException(recusa);

    switch (pedido.tipo) {
      case 'INSTALADO':
        return this.anotarInstalacao(login, tecnico, os, pedido);
      case 'RETIRADO':
        return this.anotarRetirada(login, tecnico, os, pedido);
      case 'MATERIAL':
        return this.anotarMaterial(login, tecnico, os, pedido);
      case 'DIVERGENCIA':
        return this.anotarDivergencia(login, tecnico, os, pedido);
      default:
        throw new BadRequestException('Tipo de item desconhecido.');
    }
  }

  /** Tira um item que ainda não foi ao IXC (ou que o IXC recusou). */
  async tirar(login: Login, osId: number, itemId: string): Promise<void> {
    const { tecnico } = await this.contexto(login, osId);
    const item = await this.prisma.itemDeOs.findUnique({
      where: { id: itemId },
      include: COM_REGISTRO,
    });
    if (!item || item.registro.osIxcId !== osId) {
      throw new NotFoundException('Esse item não está nesta OS.');
    }
    if (item.tecnicoId !== tecnico.funcionarioId) {
      throw new ForbiddenException('Esse item foi anotado por outro técnico.');
    }
    const { count } = await this.prisma.itemDeOs.deleteMany({
      where: { id: itemId, situacao: { in: ['PENDENTE', 'FALHOU'] } },
    });
    if (count === 0) {
      throw new BadRequestException(
        'Esse item já está no IXC (ou indo para lá) e não sai daqui. Se foi engano, ' +
          'peça à base para desfazer no IXC.',
      );
    }
  }

  /** Grava no IXC o que o técnico anotou nesta OS. */
  async gravar(login: Login, osId: number): Promise<ResultadoDaGravacao> {
    const { tecnico, os } = await this.contexto(login, osId);
    const recusa = osRecusaMaterial(os);
    if (recusa) throw new BadRequestException(recusa);
    const registro = await this.prisma.registroDeOs.findUnique({ where: { osIxcId: osId } });
    if (!registro) throw new BadRequestException('Não há nada anotado nesta OS.');
    return this.executar(registro, os, { tecnicoId: tecnico.funcionarioId }, login.nome);
  }

  // -------------------------------------------------------------------------
  // A base
  // -------------------------------------------------------------------------

  /** As OS com alguma coisa anotada, da mais recente para a mais antiga. */
  async registros(filtro: { pendencias?: boolean; tecnicoId?: string; limite?: number }) {
    await this.esquecerInterrompidos();
    const registros = await this.prisma.registroDeOs.findMany({
      where: {
        ...(filtro.pendencias
          ? { itens: { some: { situacao: { in: ['PENDENTE', 'FALHOU', 'CONFERIR'] } } } }
          : {}),
        ...(filtro.tecnicoId ? { itens: { some: { tecnicoId: filtro.tecnicoId } } } : {}),
      },
      include: { itens: { include: PARA_A_TELA, orderBy: { createdAt: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(filtro.limite ?? 200, 500),
    });
    return registros.map((r) => ({
      id: r.id,
      osIxcId: r.osIxcId,
      protocolo: r.protocolo,
      assunto: r.assunto,
      cliente: r.cliente,
      endereco: r.endereco,
      tecnicos: [...new Set(r.itens.map((i) => nomeDoTecnico(i)))],
      atualizadoEm: r.updatedAt.toISOString(),
      ...contar(r.itens),
      itens: r.itens.map(naTela),
    }));
  }

  /**
   * Leva ao IXC o que ficou pendente numa OS — a base fazendo o que o técnico
   * não conseguiu (o sinal caiu, o IXC recusou e ele não voltou).
   */
  async gravarPelaBase(registroId: string, quem: { nome: string }): Promise<ResultadoDaGravacao> {
    const registro = await this.prisma.registroDeOs.findUnique({ where: { id: registroId } });
    if (!registro) throw new NotFoundException('Registro de OS não encontrado.');
    const os = await this.doIxc.os(registro.osIxcId);
    if (!os) throw new BadRequestException(`A OS ${registro.osIxcId} não foi achada no IXC.`);
    return this.executar(registro, os, {}, quem.nome);
  }

  /**
   * O item que ficou em "conferir": alguém olhou no IXC e diz se gravou. Se
   * gravou, vira gravado (com o número da linha, quando se sabe); se não,
   * volta a poder ser gravado.
   */
  async resolverConferencia(
    itemId: string,
    dados: { gravou: boolean; ixcId?: number },
    quem: { nome: string },
  ): Promise<ItemNaTela> {
    const item = await this.prisma.itemDeOs.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item não encontrado.');
    if (item.situacao !== 'CONFERIR') {
      throw new BadRequestException('Esse item não está esperando conferência.');
    }
    const ixcId = dados.ixcId && dados.ixcId > 0 ? dados.ixcId : null;
    const atualizado = await this.prisma.itemDeOs.update({
      where: { id: itemId },
      data: dados.gravou
        ? {
            situacao: 'GRAVADO',
            gravadoEm: item.gravadoEm ?? new Date(),
            ...(ixcId && item.tipo === 'MATERIAL' ? { movimentoIxcId: ixcId } : {}),
            ...(ixcId && item.tipo === 'INSTALADO' ? { comodatoIxcId: ixcId } : {}),
            aviso: juntar(item.aviso, `Conferido no IXC por ${quem.nome}: gravou.`),
          }
        : {
            situacao: 'FALHOU',
            aviso: juntar(item.aviso, `Conferido no IXC por ${quem.nome}: não gravou.`),
          },
      include: PARA_A_TELA,
    });
    this.logger.log(
      `${quem.nome} conferiu no IXC o item ${itemId} (${item.tipo}): ${dados.gravou ? 'gravou' : 'não gravou'}.`,
    );
    return naTela(atualizado);
  }

  /** A base apaga um item que não foi ao IXC — o anotado por engano. */
  async descartar(itemId: string, quem: { nome: string }): Promise<void> {
    const { count } = await this.prisma.itemDeOs.deleteMany({
      where: { id: itemId, situacao: { in: ['PENDENTE', 'FALHOU'] } },
    });
    if (count === 0) {
      throw new BadRequestException(
        'Só sai daqui o que não foi ao IXC. O que está gravado (ou em conferência) se desfaz no IXC.',
      );
    }
    this.logger.log(`${quem.nome} descartou o item ${itemId} de uma OS.`);
  }

  // -------------------------------------------------------------------------
  // Anotar, tipo por tipo
  // -------------------------------------------------------------------------

  private async anotarInstalacao(
    login: Login,
    tecnico: TecnicoDaOs,
    os: OsDoIxc,
    pedido: PedidoDeItem,
  ): Promise<ItemNaTela> {
    const codigo = (pedido.codigo ?? '').trim();
    if (!codigo) throw new BadRequestException('Bipe ou digite o MAC, a série ou o nº do aparelho.');
    if (!os.contratoId) {
      throw new BadRequestException(
        'A OS não tem contrato no IXC, e o comodato é do contrato. Peça ao atendimento para ' +
          'pôr o contrato na OS.',
      );
    }
    const peca = await this.transferencias.acharPeca(codigo);
    if (pedido.patrimonioId && peca.patrimonioId !== pedido.patrimonioId) {
      throw new BadRequestException('O código lido não é o do aparelho escolhido. Leia de novo.');
    }
    const foraDaLista = motivoForaDosAparelhos(
      peca.produtoId,
      peca.descricao,
      await this.listaDeAparelhos(),
    );
    if (foraDaLista) throw new BadRequestException(foraDaLista);
    const motivo = motivoParaNaoInstalar(
      peca,
      tecnico.almox,
      await this.anotadosDasPecas([peca.patrimonioId]),
    );
    if (motivo) throw new BadRequestException(motivo);
    // Confere o cadastro agora: sem unidade ou classificação fiscal o IXC
    // recusaria na hora de gravar, longe de quem pode resolver.
    const produto = await this.doIxc.produtoParaOs(peca.produtoId);

    const item = await this.novoItem(login, tecnico, os, {
      tipo: 'INSTALADO',
      produtoId: produto.id,
      descricao: peca.descricao,
      unidade: produto.unidadeSigla,
      quantidade: new Prisma.Decimal(1),
      valorUnitario: new Prisma.Decimal(produto.valorUnitario),
      patrimonioId: peca.patrimonioId,
      numeroPatrimonial: peca.numeroPatrimonial,
      mac: peca.mac,
      numeroSerie: peca.numeroSerie,
      observacao: texto(pedido.observacao),
    });
    return item;
  }

  private async anotarRetirada(
    login: Login,
    tecnico: TecnicoDaOs,
    os: OsDoIxc,
    pedido: PedidoDeItem,
  ): Promise<ItemNaTela> {
    const comodatoId = Number(pedido.comodatoId);
    if (!(comodatoId > 0)) throw new BadRequestException('Escolha o aparelho que foi retirado.');
    if (!pedido.condicao) {
      throw new BadRequestException('Diga como o aparelho voltou: funcionando, com defeito ou sem testar.');
    }
    const comodatos = await this.doIxc.comodatosDoContrato(os.contratoId);
    const comodato = comodatos.find((c) => c.comodatoId === comodatoId);
    const motivo = motivoParaNaoRetirar(comodato, await this.anotadosDosComodatos([comodatoId]));
    if (motivo || !comodato) throw new BadRequestException(motivo ?? 'Comodato não achado.');
    const nomes = await this.nomesDosProdutos([comodato.produtoId]);

    return this.novoItem(login, tecnico, os, {
      tipo: 'RETIRADO',
      produtoId: comodato.produtoId,
      descricao: nomes.get(comodato.produtoId) ?? comodato.descricao ?? `Produto ${comodato.produtoId}`,
      quantidade: new Prisma.Decimal(comodato.quantidade),
      patrimonioId: comodato.patrimonioId,
      numeroPatrimonial: comodato.numeroPatrimonial,
      mac: comodato.mac,
      numeroSerie: comodato.numeroSerie,
      comodatoIxcId: comodato.comodatoId,
      condicao: pedido.condicao,
      observacao: texto(pedido.observacao),
    });
  }

  /**
   * O aparelho que o técnico trouxe e que o IXC não tem neste contrato. Não se
   * escreve no IXC — baixar o comodato de outro contrato, ou de peça nenhuma,
   * seria adivinhar. Fica anotado, com o que o IXC diz da peça (se a conhece),
   * e a base resolve.
   */
  private async anotarDivergencia(
    login: Login,
    tecnico: TecnicoDaOs,
    os: OsDoIxc,
    pedido: PedidoDeItem,
  ): Promise<ItemNaTela> {
    const codigo = (pedido.codigo ?? '').trim();
    const descricao = texto(pedido.descricao);
    if (codigo.length < 3 && !descricao) {
      throw new BadRequestException('Bipe o código do aparelho, ou escreva o que ele é.');
    }
    if (!pedido.condicao) {
      throw new BadRequestException('Diga como o aparelho voltou: funcionando, com defeito ou sem testar.');
    }
    const achada = codigo.length >= 3 ? await this.transferencias.acharPeca(codigo).catch(() => null) : null;
    const noIxc = achada
      ? `No IXC: ${achada.descricao}, ${achada.situacao}` +
        (achada.almoxarifado ? ` (${achada.almoxarifado})` : '') +
        '.'
      : codigo
        ? `O código "${codigo}" não foi achado no IXC.`
        : null;

    return this.novoItem(login, tecnico, os, {
      tipo: 'DIVERGENCIA',
      produtoId: achada?.produtoId ?? null,
      descricao: achada?.descricao ?? descricao ?? 'Aparelho sem cadastro',
      quantidade: new Prisma.Decimal(1),
      patrimonioId: achada?.patrimonioId ?? null,
      numeroPatrimonial: achada?.numeroPatrimonial ?? null,
      mac: achada?.mac ?? null,
      numeroSerie: achada ? achada.numeroSerie : codigo || null,
      condicao: pedido.condicao,
      observacao: juntar(descricao && achada ? descricao : null, texto(pedido.observacao)),
      aviso: noIxc,
    });
  }

  private async anotarMaterial(
    login: Login,
    tecnico: TecnicoDaOs,
    os: OsDoIxc,
    pedido: PedidoDeItem,
  ): Promise<ItemNaTela> {
    const produtoId = Number(pedido.produtoId);
    const quantidade = Number(pedido.quantidade);
    const [material, saldos, pendentes, registro] = await Promise.all([
      this.prisma.materialDeOs.findUnique({ where: { produtoId } }),
      this.doIxc.saldosNoAlmox(tecnico.almox.id),
      this.materialAindaNaoGravado(tecnico.almox.id),
      this.prisma.registroDeOs.findUnique({
        where: { osIxcId: os.id },
        include: { itens: { where: { tipo: 'MATERIAL', produtoId } } },
      }),
    ]);
    const nestaOs = registro?.itens ?? [];
    const observacao = texto(pedido.observacao);
    const motivo = motivoParaNaoGastar({
      // Aparelho não é material: ele se instala pela peça, em comodato.
      material: material && !material.aparelho
        ? {
            produtoId: material.produtoId,
            descricao: material.descricao,
            unidade: material.unidade,
            ativo: material.ativo,
            maximoPorOs: material.maximoPorOs === null ? null : Number(material.maximoPorOs),
          }
        : undefined,
      quantidade,
      saldo: saldos.get(produtoId) ?? 0,
      pendentes: pendentes.get(produtoId) ?? 0,
      jaNestaOs: somar(nestaOs),
      observacao: juntar(...nestaOs.map((i) => i.observacao), observacao),
    });
    if (motivo || !material) throw new BadRequestException(motivo ?? 'Material fora da lista.');
    const produto = await this.doIxc.produtoParaOs(produtoId);

    /*
     * O mesmo material duas vezes na mesma OS, ainda sem ir ao IXC, vira uma
     * linha só: "2 conectores" e depois "mais 1" é 3 conectores na OS, e não
     * duas linhas que a base teria de somar de cabeça.
     */
    const aberto = nestaOs.find(
      (i) => i.situacao === 'PENDENTE' && i.tecnicoId === tecnico.funcionarioId,
    );
    if (aberto) {
      const { count } = await this.prisma.itemDeOs.updateMany({
        where: { id: aberto.id, situacao: 'PENDENTE' },
        data: {
          quantidade: { increment: new Prisma.Decimal(quantidade) },
          observacao: juntar(aberto.observacao, observacao),
        },
      });
      if (count === 1) {
        const somado = await this.prisma.itemDeOs.findUniqueOrThrow({
          where: { id: aberto.id },
          include: PARA_A_TELA,
        });
        return naTela(somado);
      }
      // Foi ao IXC entre a leitura e agora: vira uma linha nova.
    }

    return this.novoItem(login, tecnico, os, {
      tipo: 'MATERIAL',
      produtoId,
      descricao: material.descricao,
      unidade: produto.unidadeSigla || material.unidade,
      quantidade: new Prisma.Decimal(quantidade),
      valorUnitario: new Prisma.Decimal(produto.valorUnitario),
      observacao,
    });
  }

  private async novoItem(
    login: Login,
    tecnico: TecnicoDaOs,
    os: OsDoIxc,
    dados: Omit<
      Prisma.ItemDeOsUncheckedCreateInput,
      'registroId' | 'tecnicoId' | 'almoxId' | 'almoxarifado' | 'registradoPor'
    >,
  ): Promise<ItemNaTela> {
    const registro = await this.registroDaOs(os);
    const item = await this.prisma.itemDeOs.create({
      data: {
        ...dados,
        registroId: registro.id,
        tecnicoId: tecnico.funcionarioId,
        almoxId: tecnico.almox.id,
        almoxarifado: tecnico.almox.nome,
        registradoPor: login.nome,
      },
      include: PARA_A_TELA,
    });
    this.logger.log(
      `${login.nome} anotou na OS ${os.id}: ${item.tipo} "${item.descricao}" (${Number(item.quantidade)}).`,
    );
    return naTela(item);
  }

  /** O registro da OS — criado na primeira anotação, com os dados de lá copiados. */
  private async registroDaOs(os: OsDoIxc): Promise<RegistroDeOs> {
    const [assuntos, clientes] = await Promise.all([
      this.doIxc.nomesDosAssuntos(),
      this.doIxc.nomesDosClientes([os.clienteId]),
    ]);
    const dados = {
      protocolo: os.protocolo,
      assunto: assuntos.get(os.assuntoId) ?? null,
      clienteId: os.clienteId || null,
      cliente: clientes.get(os.clienteId) ?? null,
      contratoId: os.contratoId || null,
      endereco: os.endereco,
      filialId: os.filialId,
    };
    return this.prisma.registroDeOs.upsert({
      where: { osIxcId: os.id },
      create: { osIxcId: os.id, ...dados },
      update: dados,
    });
  }

  // -------------------------------------------------------------------------
  // Gravar no IXC
  // -------------------------------------------------------------------------

  /**
   * Leva ao IXC os itens pendentes (e os que falharam) de uma OS.
   *
   * 1. **Pega os itens** — PENDENTE/FALHOU → GRAVANDO, um por um, por troca
   *    condicional. O que outro pedido pegou antes fica com ele.
   * 2. **Relê o IXC** — a van, o comodato do contrato, o saldo. Anotar foi há
   *    uma hora; o que mudou nesse meio recusa aqui, antes de escrever.
   * 3. **Escreve, na ordem** — instalado, retirado, material (`naOrdemDeGravar`).
   *    Um item recusado não para os outros: a troca aconteceu na rua, e cada
   *    pedaço dela que o IXC aceita é verdade a menos para acertar à mão.
   * 4. **Confere** — relê a peça, o comodato e o saldo. O IXC que aceita e não
   *    faz vira gravado com aviso, e não gravado em silêncio.
   */
  private async executar(
    registro: RegistroDeOs,
    os: OsDoIxc,
    filtro: { tecnicoId?: string },
    quem: string,
  ): Promise<ResultadoDaGravacao> {
    await this.esquecerInterrompidos();
    const candidatos = await this.prisma.itemDeOs.findMany({
      where: {
        registroId: registro.id,
        situacao: { in: ['PENDENTE', 'FALHOU'] },
        ...(filtro.tecnicoId ? { tecnicoId: filtro.tecnicoId } : {}),
      },
    });

    const meus: ItemDeOs[] = [];
    for (const item of naOrdemDeGravar(candidatos)) {
      const { count } = await this.prisma.itemDeOs.updateMany({
        where: { id: item.id, situacao: { in: ['PENDENTE', 'FALHOU'] } },
        data: { situacao: 'GRAVANDO', tentativas: { increment: 1 }, erro: null },
      });
      if (count === 1) meus.push(item);
    }
    const resultado: ResultadoDaGravacao = { gravados: 0, falharam: 0, conferir: 0, avisos: 0 };
    if (meus.length === 0) return resultado;

    /** Itens que chegaram a ir ao IXC — se algo estourar, esses não voltam a "falhou". */
    const enviados = new Set<string>();
    try {
      const leitura = await this.lerParaGravar(os, meus);
      const gravadosAgora: Array<{ item: ItemDeOs; ixcId: number | null }> = [];

      for (const item of meus) {
        if (item.tipo === 'DIVERGENCIA') {
          // Não há o que escrever no IXC: vai para a base conferir.
          await this.marcar(item.id, { situacao: 'GRAVADO', gravadoEm: new Date() });
          resultado.gravados += 1;
          continue;
        }
        const recusa = this.conferirAntesDeGravar(item, leitura);
        if (recusa) {
          await this.marcar(item.id, { situacao: recusa.situacao, erro: recusa.motivo });
          if (recusa.situacao === 'CONFERIR') resultado.conferir += 1;
          else resultado.falharam += 1;
          continue;
        }

        enviados.add(item.id);
        try {
          const ixcId = await this.escrever(item, os, leitura);
          gravadosAgora.push({ item, ixcId });
          await this.marcar(item.id, {
            situacao: 'GRAVADO',
            gravadoEm: new Date(),
            ...(item.tipo === 'INSTALADO' ? { comodatoIxcId: ixcId } : {}),
            ...(item.tipo === 'MATERIAL' ? { movimentoIxcId: ixcId } : {}),
          });
          resultado.gravados += 1;
        } catch (err) {
          const motivo = err instanceof Error ? err.message : String(err);
          const gravou = await this.verificarDepoisDoErro(item, os).catch(() => null);
          if (gravou) {
            this.logger.warn(`OS ${os.id}: o IXC respondeu erro (${motivo}), mas gravou o item ${item.id}.`);
            gravadosAgora.push({ item, ixcId: gravou.ixcId });
            await this.marcar(item.id, {
              situacao: 'GRAVADO',
              gravadoEm: new Date(),
              ...(item.tipo === 'INSTALADO' ? { comodatoIxcId: gravou.ixcId } : {}),
              ...(item.tipo === 'MATERIAL' ? { movimentoIxcId: gravou.ixcId } : {}),
              aviso: `O IXC respondeu erro (${motivo}), mas relido o item estava lá.`,
            });
            resultado.gravados += 1;
          } else if (gravou === false) {
            await this.marcar(item.id, { situacao: 'FALHOU', erro: motivo });
            resultado.falharam += 1;
          } else {
            await this.marcar(item.id, {
              situacao: 'CONFERIR',
              erro: `${motivo} — e relendo o IXC não deu para saber se gravou. Confira lá antes de repetir.`,
            });
            resultado.conferir += 1;
          }
        }
      }

      resultado.avisos = await this.conferirDepoisDeGravar(gravadosAgora, os, leitura);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.error(`OS ${os.id}: a gravação parou no meio (${motivo}).`);
      // O que não chegou ao IXC volta a poder ir; o que chegou, alguém confere.
      await this.prisma.itemDeOs.updateMany({
        where: { id: { in: meus.map((i) => i.id).filter((id) => !enviados.has(id)) }, situacao: 'GRAVANDO' },
        data: { situacao: 'FALHOU', erro: `Não foi ao IXC: ${motivo}` },
      });
      await this.prisma.itemDeOs.updateMany({
        where: { id: { in: [...enviados] }, situacao: 'GRAVANDO' },
        data: { situacao: 'CONFERIR', erro: `A gravação parou no meio (${motivo}). Confira no IXC.` },
      });
      throw err;
    } finally {
      this.estoque.esquecer();
      this.comodato.esquecer();
    }

    this.logger.log(
      `${quem} gravou a OS ${os.id} no IXC: ${resultado.gravados} gravado(s), ` +
        `${resultado.falharam} recusado(s), ${resultado.conferir} a conferir, ${resultado.avisos} com aviso.`,
    );
    return resultado;
  }

  /** O que a gravação precisa ler do IXC antes de escrever — só o que os itens pedem. */
  private async lerParaGravar(os: OsDoIxc, itens: ItemDeOs[]): Promise<Leitura> {
    const almoxDe = (tipo: TipoItemDeOs) =>
      [...new Set(itens.filter((i) => i.tipo === tipo).map((i) => i.almoxId))];
    const produtos = [
      ...new Set(
        itens
          .filter((i) => (i.tipo === 'INSTALADO' || i.tipo === 'MATERIAL') && i.produtoId)
          .map((i) => i.produtoId as number),
      ),
    ];

    const [prateleiras, saldos, comodatos, cadastros] = await Promise.all([
      Promise.all(
        almoxDe('INSTALADO').map(async (id) => {
          const aparelhos = await this.doIxc.aparelhosNoAlmox(id);
          return [id, new Map(aparelhos.map((a) => [a.patrimonioId, a.situacao]))] as const;
        }),
      ),
      Promise.all(
        almoxDe('MATERIAL').map(async (id) => [id, await this.doIxc.saldosNoAlmox(id)] as const),
      ),
      itens.some((i) => i.tipo === 'RETIRADO')
        ? this.doIxc.comodatosDoContrato(os.contratoId)
        : Promise.resolve([] as ComodatoDoContrato[]),
      Promise.all(
        produtos.map(async (id) => [id, await this.doIxc.produtoParaOs(id).catch((e: unknown) => e)] as const),
      ),
    ]);
    return {
      prateleiras: new Map(prateleiras),
      saldos: new Map(saldos),
      comodatos: new Map(comodatos.map((c) => [c.comodatoId, c])),
      produtos: new Map(cadastros),
      gastoAgora: new Map(),
    };
  }

  /** O item ainda pode ir? Relê o que anotar conferiu — o IXC pode ter mudado. */
  private conferirAntesDeGravar(
    item: ItemDeOs,
    leitura: Leitura,
  ): { situacao: 'FALHOU' | 'CONFERIR'; motivo: string } | null {
    const produto = item.produtoId ? leitura.produtos.get(item.produtoId) : undefined;
    if ((item.tipo === 'INSTALADO' || item.tipo === 'MATERIAL') && !ehProduto(produto)) {
      return {
        situacao: 'FALHOU',
        motivo: produto instanceof Error ? produto.message : 'O cadastro do produto não foi lido no IXC.',
      };
    }
    if (item.tipo === 'INSTALADO') {
      const naPrateleira = leitura.prateleiras.get(item.almoxId)?.has(item.patrimonioId ?? 0);
      if (!naPrateleira) {
        return {
          situacao: 'FALHOU',
          motivo: `O aparelho já não está disponível em "${item.almoxarifado}" no IXC.`,
        };
      }
    }
    if (item.tipo === 'RETIRADO' && !leitura.comodatos.has(item.comodatoIxcId ?? 0)) {
      return {
        situacao: 'CONFERIR',
        motivo:
          'O comodato já não está ativo no contrato no IXC — alguém pode ter baixado por lá. ' +
          'Confira para onde o aparelho foi.',
      };
    }
    if (item.tipo === 'MATERIAL') {
      const produtoId = item.produtoId as number;
      const saldo = leitura.saldos.get(item.almoxId)?.get(produtoId) ?? 0;
      const chave = `${item.almoxId}:${produtoId}`;
      const livre = saldo - (leitura.gastoAgora.get(chave) ?? 0);
      if (Number(item.quantidade) > livre + 1e-9) {
        return {
          situacao: 'FALHOU',
          motivo:
            `"${item.almoxarifado}" tem ${arredondar(Math.max(0, livre))} de "${item.descricao}" ` +
            `no IXC agora, e não ${Number(item.quantidade)}.`,
        };
      }
      leitura.gastoAgora.set(chave, (leitura.gastoAgora.get(chave) ?? 0) + Number(item.quantidade));
    }
    return null;
  }

  /** A escrita do item no IXC. Devolve o id da linha criada, quando há. */
  private async escrever(item: ItemDeOs, os: OsDoIxc, leitura: Leitura): Promise<number | null> {
    const naOs: OsParaEscrever = {
      osId: os.id,
      contratoId: os.contratoId,
      loginId: os.loginId,
      filialId: os.filialId,
      almoxId: item.almoxId,
      dia: hojeParaIxc(),
    };
    const lido = item.produtoId ? leitura.produtos.get(item.produtoId) : undefined;
    const produto = ehProduto(lido) ? lido : undefined;

    if (item.tipo === 'INSTALADO' && produto) {
      const { id } = await this.ixc.create(
        'su_oss_mov_comodato_wiz',
        montarComodatoNaOs(naOs, produto, {
          patrimonioId: item.patrimonioId ?? 0,
          numeroPatrimonial: item.numeroPatrimonial,
          mac: item.mac,
          numeroSerie: item.numeroSerie,
          situacao: leitura.prateleiras.get(item.almoxId)?.get(item.patrimonioId ?? 0) ?? null,
        }),
      );
      return id;
    }
    if (item.tipo === 'RETIRADO') {
      const [, almoxarifados] = await this.produtos.paraMovimentar();
      const almox = almoxarifados.find((a) => a.id === item.almoxId);
      const filialId = almox?.filialId || os.filialId;
      await this.ixc.action(
        'baixar_comodato_23069',
        montarBaixaDeComodato({
          comodatoId: item.comodatoIxcId ?? 0,
          almoxId: item.almoxId,
          almoxNome: item.almoxarifado,
          filialId,
          filialNome: await this.doIxc.nomeDaFilial(filialId),
        }),
      );
      return item.comodatoIxcId;
    }
    if (item.tipo === 'MATERIAL' && produto) {
      const { id } = await this.ixc.create(
        'su_oss_mov_produto',
        montarMaterialNaOs(naOs, produto, Number(item.quantidade)),
      );
      return id;
    }
    throw new BadRequestException(`Item ${item.tipo} sem o que escrever no IXC.`);
  }

  /**
   * O IXC respondeu erro: gravou mesmo assim? Devolve o id achado (gravou),
   * false (relido, não está lá) ou null (não deu para saber).
   */
  private async verificarDepoisDoErro(
    item: ItemDeOs,
    os: OsDoIxc,
  ): Promise<{ ixcId: number | null } | false | null> {
    if (item.tipo === 'INSTALADO') {
      const peca = await this.doIxc.patrimonio(item.patrimonioId ?? 0);
      if (!peca) return null;
      const situacao = String(peca.situacao ?? '').trim();
      if (situacao === '4') {
        const linhas = await this.doIxc
          .comodatosDaOs(os.id)
          .catch(() => [] as Array<{ id: number; patrimonioId: number }>);
        return { ixcId: linhas.find((l) => l.patrimonioId === item.patrimonioId)?.id ?? null };
      }
      const naVan =
        numeroDoIxc(peca.id_almoxarifado) === item.almoxId && situacaoDaPeca(situacao).naPrateleira;
      return naVan ? false : null;
    }
    if (item.tipo === 'RETIRADO') {
      const linha = await this.doIxc.comodato(item.comodatoIxcId ?? 0);
      if (!linha) return null;
      return linha.status === 'E' ? false : { ixcId: item.comodatoIxcId };
    }
    if (item.tipo === 'MATERIAL') {
      const [linhas, conhecidos] = await Promise.all([
        this.doIxc.materiaisDaOs(os.id),
        this.prisma.itemDeOs.findMany({
          where: { registro: { osIxcId: os.id }, movimentoIxcId: { not: null } },
          select: { movimentoIxcId: true },
        }),
      ]);
      const jaSabidos = new Set(conhecidos.map((c) => c.movimentoIxcId));
      const achada = linhas.find(
        (l) =>
          !jaSabidos.has(l.id) &&
          l.produtoId === item.produtoId &&
          Math.abs(l.quantidade - Number(item.quantidade)) < 1e-6,
      );
      return achada ? { ixcId: achada.id } : false;
    }
    return null;
  }

  /**
   * A conferência depois de gravar: o IXC aceitou, e fez? A peça instalada
   * tem de estar em comodato, a retirada de volta na van, o saldo do material
   * mais baixo. O que não bateu fica gravado com aviso — é a primeira coisa a
   * olhar se o IXC deste provedor efetivar o comodato só na finalização da OS.
   */
  private async conferirDepoisDeGravar(
    gravados: Array<{ item: ItemDeOs; ixcId: number | null }>,
    os: OsDoIxc,
    leitura: Leitura,
  ): Promise<number> {
    let avisos = 0;
    const avisar = async (itemId: string, aviso: string) => {
      avisos += 1;
      await this.marcar(itemId, { aviso });
      this.logger.warn(`OS ${os.id}, item ${itemId}: ${aviso}`);
    };

    for (const { item } of gravados.filter((g) => g.item.tipo !== 'MATERIAL')) {
      const peca = item.patrimonioId ? await this.doIxc.patrimonio(item.patrimonioId).catch(() => null) : null;
      if (!peca) continue;
      const situacao = String(peca.situacao ?? '').trim();
      const almoxId = numeroDoIxc(peca.id_almoxarifado);
      if (item.tipo === 'INSTALADO' && situacao !== '4') {
        await avisar(
          item.id,
          `O IXC aceitou o comodato na OS, mas relida a peça ainda está ` +
            `"${situacaoDaPeca(situacao).nome}". Se o IXC só efetiva o comodato ao finalizar a OS, ` +
            'é isso — confira na OS.',
        );
      }
      if (item.tipo === 'RETIRADO' && (almoxId !== item.almoxId || !situacaoDaPeca(situacao).naPrateleira)) {
        await avisar(
          item.id,
          `O IXC baixou o comodato, mas relida a peça está ` +
            `"${situacaoDaPeca(situacao).nome}" no almoxarifado #${almoxId}, e não em ` +
            `"${item.almoxarifado}". Confira para onde ela foi.`,
        );
      }
    }

    const materiais = gravados.filter((g) => g.item.tipo === 'MATERIAL');
    for (const almoxId of new Set(materiais.map((g) => g.item.almoxId))) {
      const depois = await this.doIxc.saldosNoAlmox(almoxId).catch(() => null);
      const antes = leitura.saldos.get(almoxId);
      if (!depois || !antes) continue;
      const doAlmox = materiais.filter((g) => g.item.almoxId === almoxId);
      for (const produtoId of new Set(doAlmox.map((g) => g.item.produtoId as number))) {
        const produto = leitura.produtos.get(produtoId);
        if (ehProduto(produto) && !produto.controlaEstoque) continue;
        const gasto = somar(doAlmox.filter((g) => g.item.produtoId === produtoId).map((g) => g.item));
        const esperado = (antes.get(produtoId) ?? 0) - gasto;
        if ((depois.get(produtoId) ?? 0) > esperado + 1e-6) {
          for (const g of doAlmox.filter((x) => x.item.produtoId === produtoId)) {
            await avisar(
              g.item.id,
              `O IXC gravou o material na OS, mas o saldo de "${g.item.almoxarifado}" não baixou ` +
                `(era ${arredondar(antes.get(produtoId) ?? 0)}, está ${arredondar(depois.get(produtoId) ?? 0)}). ` +
                'Confira na OS se o produto saiu do estoque.',
            );
          }
        }
      }
    }
    return avisos;
  }

  // -------------------------------------------------------------------------
  // Miúdos
  // -------------------------------------------------------------------------

  /**
   * O técnico do login e a OS — que tem de ser dele. O `id_tecnico` da OS é o
   * colaborador do IXC, o mesmo `ixcId` do cadastro: é assim que um técnico
   * não mexe na OS de outro trocando o número no pedido.
   */
  private async contexto(login: Login, osId: number): Promise<{ tecnico: TecnicoDaOs; os: OsDoIxc }> {
    if (!(osId > 0)) throw new BadRequestException('Número de OS inválido.');
    const [tecnico, os] = await Promise.all([this.tecnicos.doLogin(login.id), this.doIxc.os(osId)]);
    if (!os) throw new NotFoundException(`A OS ${osId} não foi achada no IXC.`);
    if (os.tecnicoId !== tecnico.ixcId) {
      throw new ForbiddenException(
        `A OS ${osId} não está com você no IXC. Só o técnico da OS lança o material dela — ` +
          'se ela é sua, peça ao atendimento para passá-la para você.',
      );
    }
    return { tecnico, os };
  }

  /** Quantos itens cada OS tem aqui, e quantos ainda esperam. */
  private async contagens(osIds: number[]): Promise<Map<number, ReturnType<typeof contar>>> {
    if (osIds.length === 0) return new Map();
    const registros = await this.prisma.registroDeOs.findMany({
      where: { osIxcId: { in: osIds } },
      select: { osIxcId: true, itens: { select: { situacao: true } } },
    });
    return new Map(registros.map((r) => [r.osIxcId, contar(r.itens)]));
  }

  /** O que está anotado, em qualquer OS, destas peças. */
  private async anotadosDasPecas(patrimonioIds: number[]): Promise<ItemJaAnotado[]> {
    const ids = patrimonioIds.filter((id) => id > 0);
    if (ids.length === 0) return [];
    const itens = await this.prisma.itemDeOs.findMany({
      where: { patrimonioId: { in: ids } },
      include: COM_REGISTRO,
    });
    return itens.map(jaAnotado);
  }

  /** O que está anotado, em qualquer OS, destas linhas de comodato. */
  private async anotadosDosComodatos(comodatoIds: number[]): Promise<ItemJaAnotado[]> {
    const ids = comodatoIds.filter((id) => id > 0);
    if (ids.length === 0) return [];
    const itens = await this.prisma.itemDeOs.findMany({
      where: { tipo: 'RETIRADO', comodatoIxcId: { in: ids } },
      include: COM_REGISTRO,
    });
    return itens.map(jaAnotado);
  }

  /** Os modelos de aparelho de cliente que a base marcou na lista da OS. */
  private listaDeAparelhos(): Promise<Array<{ produtoId: number; ativo: boolean }>> {
    return this.prisma.materialDeOs.findMany({
      where: { aparelho: true },
      select: { produtoId: true, ativo: true },
    });
  }

  /** Por produto, o material anotado neste almoxarifado que ainda não foi ao IXC. */
  private async materialAindaNaoGravado(almoxId: number): Promise<Map<number, number>> {
    const itens = await this.prisma.itemDeOs.findMany({
      where: { tipo: 'MATERIAL', almoxId, situacao: { in: AINDA_VAI } },
      select: { produtoId: true, quantidade: true },
    });
    const porProduto = new Map<number, number>();
    for (const i of itens) {
      if (!i.produtoId) continue;
      porProduto.set(i.produtoId, arredondar((porProduto.get(i.produtoId) ?? 0) + Number(i.quantidade)));
    }
    return porProduto;
  }

  private async nomesDosProdutos(ids: number[]): Promise<Map<number, string>> {
    const cadastros = await this.produtos.cadastrosPorId(ids).catch(
      () => new Map<number, Record<string, unknown>>(),
    );
    const nomes = new Map<number, string>();
    for (const [id, c] of cadastros) {
      const nome = String(c.descricao ?? '').trim();
      if (nome) nomes.set(id, nome);
    }
    return nomes;
  }

  /** Item esquecido em GRAVANDO (a API caiu no meio) vai para conferência. */
  private async esquecerInterrompidos(): Promise<void> {
    const { count } = await this.prisma.itemDeOs.updateMany({
      where: { situacao: 'GRAVANDO', updatedAt: { lt: new Date(Date.now() - GRAVANDO_ESQUECIDO_MS) } },
      data: {
        situacao: 'CONFERIR',
        erro: 'A gravação foi interrompida no meio. Confira no IXC se este item entrou.',
      },
    });
    if (count > 0) this.logger.warn(`${count} item(ns) de OS presos em "gravando" foram para conferência.`);
  }

  private async marcar(id: string, data: Prisma.ItemDeOsUpdateInput): Promise<void> {
    await this.prisma.itemDeOs.update({ where: { id }, data });
  }
}

/** O que a gravação leu do IXC antes de escrever. */
interface Leitura {
  /** almoxId → (peça na prateleira → a situação dela, "1" ou "7"). */
  prateleiras: Map<number, Map<number, string>>;
  /** almoxId → (produtoId → saldo). */
  saldos: Map<number, Map<number, number>>;
  /** Comodatos ativos do contrato da OS, pelo id. */
  comodatos: Map<number, ComodatoDoContrato>;
  /** produtoId → cadastro pronto para a escrita, ou o erro de lê-lo. */
  produtos: Map<number, ProdutoParaOs | unknown>;
  /** "almox:produto" → o que esta gravação já tirou. */
  gastoAgora: Map<string, number>;
}

/** O cadastro lido para a escrita — e não o erro de tê-lo lido. */
function ehProduto(p: unknown): p is ProdutoParaOs {
  return !!p && typeof p === 'object' && !(p instanceof Error) && 'unidadeId' in p;
}

function naLista(
  os: OsDoIxc,
  assuntos: Map<number, string>,
  clientes: Map<number, string>,
  contagem: ReturnType<typeof contar> | undefined,
  agora: Date,
): OsNaLista {
  return {
    id: os.id,
    protocolo: os.protocolo,
    status: os.status,
    statusNome: STATUS_DA_OS[os.status] ?? os.status,
    assunto: assuntos.get(os.assuntoId) ?? (os.assuntoId ? `Assunto ${os.assuntoId}` : null),
    cliente: clientes.get(os.clienteId) ?? (os.clienteId ? `Cliente ${os.clienteId}` : null),
    endereco: os.endereco,
    abertura: os.abertura,
    agenda: os.agenda,
    recusa: osRecusaMaterial(os, agora),
    anotados: contagem?.anotados ?? 0,
    pendentes: contagem?.pendentes ?? 0,
    problemas: contagem?.problemas ?? 0,
  };
}

function contar(itens: Array<{ situacao: SituacaoItemDeOs }>) {
  return {
    anotados: itens.length,
    pendentes: itens.filter((i) => i.situacao === 'PENDENTE').length,
    problemas: itens.filter((i) => i.situacao === 'FALHOU' || i.situacao === 'CONFERIR').length,
  };
}

function jaAnotado(i: ItemDeOs & { registro: { osIxcId: number; cliente: string | null } }): ItemJaAnotado {
  return {
    tipo: i.tipo,
    situacao: i.situacao,
    osIxcId: i.registro.osIxcId,
    produtoId: i.produtoId,
    patrimonioId: i.patrimonioId,
    comodatoIxcId: i.comodatoIxcId,
    quantidade: Number(i.quantidade),
    recebido: !!i.recebidoEm,
    cliente: i.registro.cliente,
    dia: (i.gravadoEm ?? i.createdAt).toISOString().slice(0, 10),
  };
}

export function naTela(i: ItemComTecnico): ItemNaTela {
  return {
    id: i.id,
    tipo: i.tipo,
    situacao: i.situacao,
    descricao: i.descricao,
    unidade: i.unidade,
    quantidade: Number(i.quantidade),
    valorUnitario: i.valorUnitario === null ? null : Number(i.valorUnitario),
    patrimonioId: i.patrimonioId,
    numeroPatrimonial: i.numeroPatrimonial,
    mac: i.mac,
    numeroSerie: i.numeroSerie,
    comodatoIxcId: i.comodatoIxcId,
    movimentoIxcId: i.movimentoIxcId,
    condicao: i.condicao,
    observacao: i.observacao,
    erro: i.erro,
    aviso: i.aviso,
    tentativas: i.tentativas,
    gravadoEm: i.gravadoEm?.toISOString() ?? null,
    recebidoEm: i.recebidoEm?.toISOString() ?? null,
    recebidoPor: i.recebidoPor,
    destinoAlmox: i.destinoAlmox,
    tecnico: nomeDoTecnico(i),
    almoxarifado: i.almoxarifado,
    registradoPor: i.registradoPor,
    criadoEm: i.createdAt.toISOString(),
  };
}

function nomeDoTecnico(i: ItemComTecnico): string {
  return i.tecnico.apelido || i.tecnico.nome;
}

function somar(itens: Array<{ quantidade: Prisma.Decimal | number }>): number {
  return arredondar(itens.reduce((s, i) => s + Number(i.quantidade), 0));
}

function arredondar(n: number): number {
  return Math.round(n * 100_000) / 100_000;
}

function texto(v: unknown): string | null {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, 500) : null;
}

/** Junta observações sem repetir e sem "null" no meio. */
function juntar(...partes: Array<string | null | undefined>): string | null {
  const vistas = [...new Set(partes.map((p) => (p ?? '').trim()).filter(Boolean))];
  return vistas.length ? vistas.join(' · ').slice(0, 1000) : null;
}
