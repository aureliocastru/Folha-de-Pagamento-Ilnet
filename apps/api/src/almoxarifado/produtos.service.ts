import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FornecedorService } from '../financeiro/fornecedor.service';
import { IxcClient } from '../ixc/ixc.client';
import {
  naoControlaEstoque,
  rastrearNegativo,
  type RastreioDoNegativo,
} from './acerto-negativos';
import { numeroDoIxc, type ItemDeEstoque } from './estoque.mapper';
import { EstoqueService } from './estoque.service';
import {
  DOCUMENTO_DO_ACERTO,
  fiscalQueFalta,
  hojeParaIxc,
  montarEdicaoProduto,
  montarEntrada,
  montarItemDaEntrada,
  montarItemDaTransferencia,
  montarNovoProduto,
  montarTransferencia,
  type EdicaoDoProduto,
} from './produtos-ixc';

/** Teto de movimentos lidos por produto × almoxarifado no rastreio. */
const MOVIMENTOS_LIDOS = 10_000;

/** O produto como a janela de edição o mostra. */
export interface ProdutoNaTela {
  id: number;
  descricao: string;
  precoBase: number;
  ativo: boolean;
  unidadeId: number;
  unidade: string | null;
  /** `produtos.tipo`: C comércio, O consumo, M matéria-prima… */
  tipo: string;
  /**
   * "Controla estoque" do cadastro. Desligado, o IXC grava transferência e
   * entrada sem mexer no saldo — a tela avisa e oferece ligar.
   */
  controlaEstoque: boolean;
  /**
   * O fiscal obrigatório que o cadastro não tem ("o NCM"…). Com algum aqui, o
   * IXC recusa qualquer gravação no produto até alguém completar.
   */
  faltaFiscal: string[];
  /** O saldo de cada almoxarifado, lido agora do IXC. */
  saldos: ItemDeEstoque['saldos'];
  total: number;
}

/** O que os formulários precisam para oferecer escolhas, e não campos de digitar ID. */
export interface OpcoesDoEstoque {
  unidades: Array<{ id: number; sigla: string; descricao: string }>;
  almoxarifados: Array<{ id: number; nome: string; filialId: number; ativo: boolean }>;
  tiposDeDocumento: Array<{ id: number; nome: string }>;
  condicoesDePagamento: Array<{ id: number; nome: string }>;
}

/** O que a conferência depois de mexer no saldo achou. */
export interface Conferencia {
  /** O saldo mudou no IXC como esperado. */
  confere: boolean;
  antes: number;
  depois: number;
}

interface Quem {
  nome: string;
}

/**
 * Mexer nos produtos do estoque — no IXC.
 *
 * Tudo aqui escreve lá, e só lá: o estoque desta casa é o do IXC. Cada escrita
 * segue três passos, e nenhum é enfeite:
 *
 *  1. **lê antes** — o produto inteiro, para a edição devolver o cadastro
 *     completo (o `PUT` do IXC reescreve a linha) e para conferir saldo;
 *  2. **escreve** pelo caminho que a documentação da API do IXC descreve
 *     (os corpos estão em `produtos-ixc.ts`, com a requisição de origem);
 *  3. **relê** — e a tela mostra o que ficou no IXC, e não o que foi mandado.
 */
@Injectable()
export class ProdutosService {
  private readonly logger = new Logger(ProdutosService.name);

  constructor(
    private readonly ixc: IxcClient,
    private readonly estoque: EstoqueService,
    private readonly fornecedores: FornecedorService,
  ) {}

  async detalhar(produtoId: number): Promise<ProdutoNaTela> {
    const bruto = await this.lerProduto(produtoId);
    const saldos = await this.estoque.saldosDoProduto(produtoId);
    const unidades = await this.unidades();
    const unidadeId = numeroDoIxc(bruto.unidade);
    return {
      id: produtoId,
      descricao: String(bruto.descricao ?? '').trim() || `Produto ${produtoId}`,
      precoBase: numeroDoIxc(bruto.preco_base),
      ativo: String(bruto.ativo ?? 'S').toUpperCase() !== 'N',
      unidadeId,
      unidade: unidades.find((u) => u.id === unidadeId)?.sigla ?? null,
      tipo: String(bruto.tipo ?? ''),
      controlaEstoque: !naoControlaEstoque(bruto),
      faltaFiscal: fiscalQueFalta(bruto),
      saldos: saldos?.saldos ?? [],
      total: saldos?.total ?? 0,
    };
  }

  async opcoes(): Promise<OpcoesDoEstoque> {
    const [unidades, almoxarifados, tiposDeDocumento, condicoesDePagamento] =
      await Promise.all([
        this.unidades(),
        this.almoxarifados(),
        this.tiposDeDocumento(),
        this.condicoesDePagamento(),
      ]);
    return { unidades, almoxarifados, tiposDeDocumento, condicoesDePagamento };
  }

  /** Fornecedores do IXC para a entrada de compra — só leitura, só os ativos. */
  buscarFornecedores(termo: string) {
    return this.fornecedores.buscarNoIxcPorNome(termo);
  }

  // --- Cadastro ---

  /**
   * `modeloId`: o produto parecido de onde sai o fiscal que falta — só para o
   * produto que nasceu no IXC sem NCM, subgrupo ou classificação fiscal, que
   * o IXC não deixa gravar de outro jeito.
   */
  async editar(
    produtoId: number,
    { modeloId, ...mudancas }: EdicaoDoProduto & { modeloId?: number },
    quem: Quem,
  ) {
    const atual = await this.lerProduto(produtoId);
    if (mudancas.descricao !== undefined) {
      await this.recusarNomeRepetido(mudancas.descricao, produtoId);
    }
    const modelo = modeloId ? await this.lerProduto(modeloId) : undefined;
    const corpo = montarEdicaoProduto(atual, mudancas, modelo);
    try {
      await this.ixc.update('produtos', produtoId, corpo);
    } catch (err) {
      const falta = fiscalQueFalta(corpo);
      if (falta.length === 0) throw err;
      const motivo = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `Este produto está sem ${falta.join(', ')} no IXC, e o IXC confere isso a ` +
          'cada gravação — por isso não aceita nem troca de nome. Escolha um produto ' +
          `parecido para copiar o fiscal que falta. (${motivo})`,
      );
    }
    this.estoque.esquecer();
    this.logger.log(
      `${quem.nome} alterou o produto #${produtoId} no IXC: ` +
        Object.keys(mudancas).join(', ') +
        (modeloId ? ` (fiscal completado do modelo #${modeloId})` : ''),
    );
    return this.detalhar(produtoId);
  }

  async criar(
    dados: { descricao: string; precoBase: number; unidadeId: number; modeloId: number },
    quem: Quem,
  ): Promise<ProdutoNaTela> {
    await this.recusarNomeRepetido(dados.descricao);
    const modelo = await this.lerProduto(dados.modeloId);
    const { id } = await this.ixc.create('produtos', montarNovoProduto(dados, modelo));
    if (!id) {
      throw new BadRequestException(
        'O IXC aceitou o cadastro mas não devolveu o código do produto novo. ' +
          'Confira no IXC antes de cadastrar de novo — ele pode ter sido criado.',
      );
    }
    this.estoque.esquecer();
    this.logger.log(
      `${quem.nome} cadastrou o produto #${id} no IXC ("${dados.descricao}", ` +
        `modelo #${dados.modeloId}).`,
    );
    return this.detalhar(id);
  }

  /**
   * Apaga o produto no IXC.
   *
   * Só com o saldo zerado em todo almoxarifado: apagar um produto que ainda
   * está na prateleira sumiria com o material do estoque sem baixa nenhuma.
   * E o IXC pode recusar mesmo zerado — produto que já teve compra, OS ou
   * comodato fica preso no histórico. Aí o caminho é desativar, e a mensagem
   * diz isso.
   */
  async apagar(produtoId: number, quem: Quem): Promise<void> {
    const produto = await this.detalhar(produtoId);
    const comSaldo = produto.saldos.filter((s) => s.saldo !== 0);
    if (comSaldo.length > 0) {
      throw new BadRequestException(
        `"${produto.descricao}" ainda tem saldo em ` +
          comSaldo.map((s) => `${s.almoxarifado} (${s.saldo})`).join(', ') +
          '. Zere o saldo antes de apagar, ou desative o produto.',
      );
    }
    try {
      await this.ixc.remove('produtos', produtoId);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `O IXC não deixou apagar "${produto.descricao}" (${motivo}). Isso ` +
          'acontece com produto que já teve movimento — desative-o em vez de apagar.',
      );
    }
    this.estoque.esquecer();
    this.logger.log(`${quem.nome} apagou o produto #${produtoId} ("${produto.descricao}") no IXC.`);
  }

  // --- Saldo ---

  /**
   * Leva uma quantidade de um almoxarifado para outro, pela transferência do
   * IXC: a transferência, e o item dentro dela ("após cadastrar, já é feito a
   * transferência").
   */
  async transferir(
    produtoId: number,
    dados: { de: number; para: number; quantidade: number; observacao?: string },
    quem: Quem,
  ): Promise<{ transferenciaId: number; origem: Conferencia; destino: Conferencia }> {
    const [produto, bruto, almoxarifados, unidades] = await Promise.all([
      this.detalhar(produtoId),
      this.lerProduto(produtoId),
      this.almoxarifados(),
      this.unidades(),
    ]);

    const origem = almoxarifados.find((a) => a.id === dados.de);
    const destino = almoxarifados.find((a) => a.id === dados.para);
    if (!origem || !destino) {
      throw new BadRequestException(
        `O sistema não enxerga o almoxarifado de ${!origem ? 'origem' : 'destino'} no IXC — ` +
          'é de técnico e não está liberado. Libere na aba Almoxarifados e tente de novo.',
      );
    }
    if (!destino.ativo) {
      throw new BadRequestException(`O almoxarifado "${destino.nome}" está desativado no IXC.`);
    }
    const saldoOrigem = produto.saldos.find((s) => s.almoxId === dados.de)?.saldo ?? 0;
    if (dados.quantidade > saldoOrigem + 1e-9) {
      throw new BadRequestException(
        `"${origem.nome}" tem ${saldoOrigem} de "${produto.descricao}" — ` +
          `não dá para transferir ${dados.quantidade}.`,
      );
    }
    const saldoDestino = produto.saldos.find((s) => s.almoxId === dados.para)?.saldo ?? 0;
    const unidade = this.unidadeDoProduto(bruto, unidades);

    const { id: transferenciaId } = await this.ixc.create(
      'transf_almox_top',
      montarTransferencia({
        almoxSaida: origem.id,
        filialSaida: origem.filialId,
        almoxEntrada: destino.id,
        filialEntrada: destino.filialId,
        data: hojeParaIxc(),
        observacao:
          (dados.observacao?.trim() ? `${dados.observacao.trim()} — ` : '') +
          `pelo ILNET FINANCE, ${quem.nome}`,
      }),
    );
    if (!transferenciaId) {
      throw new BadRequestException(
        'O IXC não devolveu o número da transferência — nada foi movido. Tente de novo.',
      );
    }

    try {
      await this.ixc.create(
        'transf_almox_item',
        montarItemDaTransferencia(transferenciaId, {
          produtoId,
          unidadeId: unidade.id,
          unidadeSigla: unidade.sigla,
          quantidade: dados.quantidade,
          tipoProduto: String(bruto.tipo ?? ''),
        }),
      );
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `A transferência #${transferenciaId} foi aberta no IXC, mas o produto não ` +
          `entrou nela (${motivo}). O saldo não mudou — apague a transferência ` +
          `#${transferenciaId} no IXC ou inclua o produto por lá.`,
      );
    }

    this.estoque.esquecer();
    const depois = await this.estoque.saldosDoProduto(produtoId);
    const saldoDe = (almoxId: number) =>
      depois?.saldos.find((s) => s.almoxId === almoxId)?.saldo ?? 0;
    const conferir = (antes: number, agora: number, esperado: number): Conferencia => ({
      antes,
      depois: agora,
      confere: Math.abs(agora - esperado) < 1e-6,
    });

    this.logger.log(
      `${quem.nome} transferiu ${dados.quantidade} de "${produto.descricao}" de ` +
        `${origem.nome} para ${destino.nome} (transferência #${transferenciaId} no IXC).`,
    );
    return {
      transferenciaId,
      origem: conferir(saldoOrigem, saldoDe(origem.id), saldoOrigem - dados.quantidade),
      destino: conferir(saldoDestino, saldoDe(destino.id), saldoDestino + dados.quantidade),
    };
  }

  /**
   * Põe quantidade no estoque pela entrada de compra do IXC — o caminho que a
   * documentação tem para o saldo subir. A compra nasce aberta (é assim no
   * exemplo da API, e ela não documenta o botão de finalizar): quem gera o
   * financeiro dela é o IXC, ao finalizar lá.
   *
   * A conferência no fim diz se o saldo já subiu. Se o IXC só soma a compra
   * depois de finalizada, a tela avisa com o número dela — em vez de dizer que
   * deu certo sem ter visto.
   */
  async darEntrada(
    produtoId: number,
    dados: {
      almoxId: number;
      quantidade: number;
      valorUnitario: number;
      fornecedorId: number;
      tipoDocumentoId: number;
      condicaoPagamentoId: number;
      numeroNota?: string;
    },
    quem: Quem,
  ): Promise<{ entradaId: number; conferencia: Conferencia }> {
    const [produto, bruto, almoxarifados, unidades] = await Promise.all([
      this.detalhar(produtoId),
      this.lerProduto(produtoId),
      this.almoxarifados(),
      this.unidades(),
    ]);
    const almox = almoxarifados.find((a) => a.id === dados.almoxId);
    if (!almox) {
      throw new BadRequestException(
        'O sistema não enxerga esse almoxarifado no IXC — é de técnico e não está liberado. ' +
          'Libere na aba Almoxarifados e tente de novo.',
      );
    }
    if (!almox.ativo) {
      throw new BadRequestException(`O almoxarifado "${almox.nome}" está desativado no IXC.`);
    }
    const unidade = this.unidadeDoProduto(bruto, unidades);
    const saldoAntes = produto.saldos.find((s) => s.almoxId === almox.id)?.saldo ?? 0;
    const data = hojeParaIxc();
    const valorTotal = Math.round(dados.quantidade * dados.valorUnitario * 100) / 100;

    const { id: entradaId } = await this.ixc.create(
      'entrada',
      montarEntrada({
        tipoDocumentoId: dados.tipoDocumentoId,
        fornecedorId: dados.fornecedorId,
        condicaoPagamentoId: dados.condicaoPagamentoId,
        filialId: almox.filialId,
        data,
        numeroNota: dados.numeroNota?.trim() ?? '',
        valorTotal,
      }),
    );
    if (!entradaId) {
      throw new BadRequestException(
        'O IXC não devolveu o número da compra — nada foi lançado. Tente de novo.',
      );
    }

    try {
      await this.ixc.create(
        'movimento_produtos',
        montarItemDaEntrada(entradaId, {
          produtoId,
          unidadeId: unidade.id,
          unidadeSigla: unidade.sigla,
          almoxId: almox.id,
          filialId: almox.filialId,
          quantidade: dados.quantidade,
          valorUnitario: dados.valorUnitario,
          data,
        }),
      );
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `A compra #${entradaId} foi aberta no IXC, mas o produto não entrou nela ` +
          `(${motivo}). O saldo não mudou — apague a compra #${entradaId} no IXC ` +
          'ou inclua o produto por lá.',
      );
    }

    this.estoque.esquecer();
    const depois = await this.estoque.saldosDoProduto(produtoId);
    const saldoDepois = depois?.saldos.find((s) => s.almoxId === almox.id)?.saldo ?? 0;

    this.logger.log(
      `${quem.nome} deu entrada de ${dados.quantidade} de "${produto.descricao}" em ` +
        `${almox.nome} (compra #${entradaId} no IXC, aberta).`,
    );
    return {
      entradaId,
      conferencia: {
        antes: saldoAntes,
        depois: saldoDepois,
        confere: Math.abs(saldoDepois - (saldoAntes + dados.quantidade)) < 1e-6,
      },
    };
  }

  // --- Leituras de apoio ---

  private async lerProduto(produtoId: number): Promise<Record<string, unknown>> {
    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      throw new BadRequestException('Código de produto inválido.');
    }
    const bruto = await this.ixc.getById<Record<string, unknown>>(
      'produtos',
      'produtos.id',
      produtoId,
    );
    if (!bruto) throw new NotFoundException(`O produto #${produtoId} não existe no IXC.`);
    return bruto;
  }

  /**
   * Nome repetido não entra: dois "Conector APC" no IXC viram dois saldos para
   * a mesma peça, e ninguém sabe em qual dar baixa.
   */
  private async recusarNomeRepetido(descricao: string, menosEste?: number): Promise<void> {
    const nome = descricao.trim().replace(/\s+/g, ' ');
    if (!nome) return;
    const res = await this.ixc.list<Record<string, unknown>>('produtos', {
      qtype: 'produtos.descricao',
      query: nome,
      oper: '=',
      rp: 5,
    });
    const outro = res.registros.find(
      (p) =>
        numeroDoIxc(p.id) !== menosEste &&
        String(p.descricao ?? '').trim().toLowerCase() === nome.toLowerCase(),
    );
    if (outro) {
      throw new BadRequestException(
        `Já existe um produto "${String(outro.descricao).trim()}" no IXC ` +
          `(código ${numeroDoIxc(outro.id)}).`,
      );
    }
  }

  private unidadeDoProduto(
    bruto: Record<string, unknown>,
    unidades: OpcoesDoEstoque['unidades'],
  ): { id: number; sigla: string } {
    const id = numeroDoIxc(bruto.unidade);
    const unidade = unidades.find((u) => u.id === id);
    if (!unidade) {
      throw new BadRequestException(
        'O produto está sem unidade no IXC (ou com uma que não existe mais). ' +
          'Escolha a unidade na edição do produto antes de movimentar.',
      );
    }
    return { id: unidade.id, sigla: unidade.sigla };
  }

  /**
   * O que a transferência de vários itens (`TransferenciasService`) precisa
   * daqui: as unidades e os almoxarifados que o sistema enxerga, com a filial.
   */
  paraMovimentar(): Promise<
    [OpcoesDoEstoque['unidades'], OpcoesDoEstoque['almoxarifados']]
  > {
    return Promise.all([this.unidades(), this.almoxarifados()]);
  }

  /**
   * Os movimentos de um produto num almoxarifado, crus como o IXC devolve —
   * a matéria do rastreio (`rastrearNegativo`). Visto em produção: a
   * transferência aparece em `movimento_produtos` com `id_transf_almox_item`,
   * e o número dela vem de `transf_almox_item`; OS e comodato vêm sem número.
   */
  async movimentosCrus(
    produtoId: number,
    almoxId: number,
  ): Promise<{ movimentos: Array<Record<string, unknown>>; transferencias: Array<Record<string, unknown>> }> {
    const [movimentos, transferencias] = await Promise.all([
      this.ixc.listAll<Record<string, unknown>>(
        'movimento_produtos',
        {
          qtype: 'movimento_produtos.id_produto',
          query: String(produtoId),
          oper: '=',
          sortname: 'movimento_produtos.id',
          sortorder: 'asc',
          gridParam: [{ TB: 'movimento_produtos.id_almox', OP: '=', P: String(almoxId) }],
        },
        { pageSize: 500, maxPages: MOVIMENTOS_LIDOS / 500 },
      ),
      this.ixc
        .listAll<Record<string, unknown>>(
          'transf_almox_item',
          {
            qtype: 'transf_almox_item.id_produto',
            query: String(produtoId),
            oper: '=',
            sortname: 'transf_almox_item.id',
            sortorder: 'asc',
          },
          { pageSize: 500, maxPages: 10 },
        )
        .catch((e: unknown) => [{ erro: e instanceof Error ? e.message : String(e) }]),
    ]);
    return { movimentos, transferencias };
  }

  /**
   * O saldo do produto no almoxarifado somando os movimentos que valem
   * (`estoque = S`) — a conferência da tabela de saldos, que já mostrou saldo
   * que os movimentos não tinham (o notebook do RABELO, 11/09/2026).
   */
  async saldoPelosMovimentos(produtoId: number, almoxId: number): Promise<number> {
    const movimentos = await this.ixc.listAll<Record<string, unknown>>(
      'movimento_produtos',
      {
        qtype: 'movimento_produtos.id_produto',
        query: String(produtoId),
        oper: '=',
        sortname: 'movimento_produtos.id',
        sortorder: 'asc',
        gridParam: [{ TB: 'movimento_produtos.id_almox', OP: '=', P: String(almoxId) }],
      },
      { pageSize: 500, maxPages: MOVIMENTOS_LIDOS / 500 },
    );
    return rastrearNegativo(movimentos, []).saldoPelosMovimentos;
  }

  /**
   * Uma compra (entrada) do IXC, crua — o cabeçalho e os itens. Para comparar
   * a compra que o sistema monta com uma feita na tela do IXC, que o IXC aceita.
   */
  async entradaCrua(entradaId: number): Promise<{
    entrada: Record<string, unknown> | null;
    itens: Array<Record<string, unknown>>;
  }> {
    const [entrada, itens] = await Promise.all([
      this.ixc.getById<Record<string, unknown>>('entrada', 'entrada.id', entradaId),
      this.ixc.listAll<Record<string, unknown>>(
        'movimento_produtos',
        {
          qtype: 'movimento_produtos.id_entrada',
          query: String(entradaId),
          oper: '=',
          sortname: 'movimento_produtos.id',
          sortorder: 'asc',
        },
        { pageSize: 200, maxPages: 1 },
      ),
    ]);
    return { entrada, itens };
  }

  /**
   * As compras **de acerto** abertas do fornecedor — só as que o acerto de
   * negativos criou (marcadas no campo "Documento"), da mais nova para a mais
   * velha. As outras compras abertas dele são do IXC e fazem parte do saldo:
   * o Fornecedor Avulso tem compras abertas de 2020 a 2023, e a primeira
   * versão desta lista as mostrava com "Desfazer" (11/09/2026).
   */
  async entradasAbertasDoFornecedor(
    fornecedorId: number,
  ): Promise<Array<{ entradaId: number; data: string; itens: number; valorTotal: number }>> {
    const abertas = await this.ixc.listAll<Record<string, unknown>>(
      'entrada',
      {
        qtype: 'entrada.id_fornecedor',
        query: String(fornecedorId),
        oper: '=',
        sortname: 'entrada.id',
        sortorder: 'desc',
        gridParam: [{ TB: 'entrada.status', OP: '=', P: 'A' }],
      },
      { pageSize: 50, maxPages: 2 },
    );
    return Promise.all(
      abertas
        .filter((e) => String(e.status ?? '').toUpperCase() === 'A')
        .filter((e) => String(e.documento ?? '').trim() === DOCUMENTO_DO_ACERTO)
        .map(async (e) => {
          const entradaId = numeroDoIxc(e.id);
          const itens = await this.ixc.list('movimento_produtos', {
            qtype: 'movimento_produtos.id_entrada',
            query: String(entradaId),
            oper: '=',
            rp: 1,
          });
          return {
            entradaId,
            data: String(e.data_entrada ?? ''),
            itens: itens.total,
            valorTotal: numeroDoIxc(e.valor_total),
          };
        }),
    );
  }

  /**
   * A última compra do fornecedor — o modelo da compra de acerto. O tipo de
   * documento que a tela do IXC usa (203, na #3403) nem aparece na tabela de
   * tipos que a API lista; copiar de uma compra que o IXC aceitou é o jeito
   * de acertar o tipo e a condição sem adivinhar.
   */
  async ultimaEntradaDoFornecedor(fornecedorId: number): Promise<{
    entradaId: number;
    tipoDocumentoId: number;
    condicaoPagamentoId: number;
  } | null> {
    const res = await this.ixc.list<Record<string, unknown>>('entrada', {
      qtype: 'entrada.id_fornecedor',
      query: String(fornecedorId),
      oper: '=',
      rp: 1,
      sortname: 'entrada.id',
      sortorder: 'desc',
    });
    const e = res.registros[0];
    if (!e) return null;
    return {
      entradaId: numeroDoIxc(e.id),
      tipoDocumentoId: numeroDoIxc(e.tipo_documento),
      condicaoPagamentoId: numeroDoIxc(e.condicoes_pagamento),
    };
  }

  /** Em qual movimento o saldo do produto ficou negativo neste almoxarifado. */
  async rastreio(produtoId: number, almoxId: number): Promise<RastreioDoNegativo> {
    const { movimentos, transferencias } = await this.movimentosCrus(produtoId, almoxId);
    return rastrearNegativo(movimentos, transferencias, MOVIMENTOS_LIDOS);
  }

  /**
   * Os cadastros crus dos produtos pelos ids. Poucos, um a um; muitos, a
   * tabela inteira de uma vez — centenas de consultas custam mais que ela.
   */
  async cadastrosPorId(ids: number[]): Promise<Map<number, Record<string, unknown>>> {
    const unicos = [...new Set(ids)].filter((id) => id > 0);
    const mapa = new Map<number, Record<string, unknown>>();
    if (unicos.length === 0) return mapa;
    if (unicos.length <= 40) {
      const achados = await Promise.all(
        unicos.map((id) =>
          this.ixc
            .getById<Record<string, unknown>>('produtos', 'produtos.id', id)
            .catch(() => null),
        ),
      );
      achados.forEach((p, i) => {
        if (p) mapa.set(unicos[i], p);
      });
      return mapa;
    }
    const procurados = new Set(unicos);
    const todos = await this.ixc.listAll<Record<string, unknown>>(
      'produtos',
      { qtype: 'produtos.id', query: '0', oper: '>', sortname: 'produtos.id', sortorder: 'asc' },
      { pageSize: 500 },
    );
    for (const p of todos) {
      const id = numeroDoIxc(p.id);
      if (procurados.has(id)) mapa.set(id, p);
    }
    return mapa;
  }

  private async unidades(): Promise<OpcoesDoEstoque['unidades']> {
    const linhas = await this.ixc.listAll<Record<string, unknown>>(
      'unidades',
      { qtype: 'unidades.id', query: '0', oper: '>', sortname: 'unidades.id', sortorder: 'asc' },
      { pageSize: 200, maxPages: 5 },
    );
    return linhas
      .map((u) => ({
        id: numeroDoIxc(u.id),
        sigla: String(u.sigla ?? '').trim(),
        descricao: String(u.descricao ?? '').trim(),
      }))
      .filter((u) => u.id > 0 && u.sigla)
      .sort((a, b) => a.sigla.localeCompare(b.sigla, 'pt-BR'));
  }

  /** A tabela `almox` ("Almoxarifados (listar)"): nome, filial e se está ativo. */
  private async almoxarifados(): Promise<OpcoesDoEstoque['almoxarifados']> {
    const linhas = await this.ixc.listAll<Record<string, unknown>>(
      'almox',
      { qtype: 'almox.id', query: '0', oper: '>', sortname: 'almox.id', sortorder: 'asc' },
      { pageSize: 200, maxPages: 5 },
    );
    return linhas
      .map((a) => ({
        id: numeroDoIxc(a.id),
        nome: String(a.descricao ?? '').trim() || `Almoxarifado ${numeroDoIxc(a.id)}`,
        filialId: numeroDoIxc(a.id_filial),
        ativo: String(a.ativo ?? 'S').toUpperCase() !== 'N',
      }))
      .filter((a) => a.id > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /**
   * Os tipos de documento da compra. A tabela (`tipo_documento`) é citada pela
   * documentação da entrada, mas os campos dela não estão lá — então o nome
   * vem da primeira coluna de texto que existir, e a tela mostra o código
   * junto para ninguém escolher pelo nome errado.
   */
  private async tiposDeDocumento(): Promise<OpcoesDoEstoque['tiposDeDocumento']> {
    const linhas = await this.ixc.listAll<Record<string, unknown>>(
      'tipo_documento',
      {
        qtype: 'tipo_documento.id',
        query: '0',
        oper: '>',
        sortname: 'tipo_documento.id',
        sortorder: 'asc',
      },
      { pageSize: 200, maxPages: 5 },
    );
    return linhas
      .map((t) => ({
        id: numeroDoIxc(t.id),
        nome:
          String(t.descricao ?? t.nome ?? t.tipo_documento ?? '').trim() ||
          `Tipo ${numeroDoIxc(t.id)}`,
      }))
      .filter((t) => t.id > 0);
  }

  /** As condições de pagamento ativas que servem para compra (entrada ou ambas). */
  private async condicoesDePagamento(): Promise<OpcoesDoEstoque['condicoesDePagamento']> {
    const linhas = await this.ixc.listAll<Record<string, unknown>>(
      'condicoes_pagamento',
      {
        qtype: 'condicoes_pagamento.id',
        query: '0',
        oper: '>',
        sortname: 'condicoes_pagamento.id',
        sortorder: 'asc',
      },
      { pageSize: 200, maxPages: 5 },
    );
    return linhas
      .filter((c) => String(c.ativo ?? 'S').toUpperCase() !== 'N')
      .filter((c) => ['A', 'C', ''].includes(String(c.compra_venda ?? '').toUpperCase()))
      .map((c) => ({
        id: numeroDoIxc(c.id),
        nome: String(c.nome ?? '').trim() || `Condição ${numeroDoIxc(c.id)}`,
      }))
      .filter((c) => c.id > 0);
  }
}
