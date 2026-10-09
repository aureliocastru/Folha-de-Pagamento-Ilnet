import { Injectable, Logger } from '@nestjs/common';
import { Prisma, StatusContaPagar, TipoLancamento } from '@prisma/client';
import { FechamentoCaixaService } from '../caixa/fechamento-caixa.service';
import { CartoesCreditoService } from '../contas-abertas/cartoes-credito.service';
import { CategoriasService } from '../contas-abertas/categorias.service';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConfiguracaoContabilService,
  papelSugerido,
  type PapelDaConta,
} from './configuracao.service';
import {
  centavos,
  diaDoIxc,
  idDoIxc,
  lerPorIds,
  lerTudo,
  numero,
  texto,
  type Pergunta,
} from './ixc-leitura';
import { lerOfx } from './ofx';
import type { CaixaNoPeriodo } from './relatorios/caixa';
import { relatorioDeClientes } from './relatorios/clientes';
import { lerLancamentoDoIxc, relatorioDeConciliacao } from './relatorios/conciliacao';
import { MENOR_CUSTO_DE_VERDADE, relatorioDeEstoque } from './relatorios/estoque';
import {
  foiPagoNoPeriodo,
  lerPagamento,
  relatorioDeFornecedores,
  type CadastrosDoPagar,
  type Pagamento,
} from './relatorios/pagamentos';
import {
  relatorioDeCartoes,
  relatorioDeVales,
  type AdiantamentoAoFuncionario,
  type FaturaDoPeriodo,
} from './relatorios/pessoas';
import {
  lerRecebimento,
  relatorioDeFaturamento,
  relatorioDeJuros,
  relatorioDeVendasNoCartao,
  type Cadastros,
  type Recebimento,
} from './relatorios/receitas';
import type { Relatorio } from './relatorios/relatorio';

/** Uma conta do IXC, com o papel dela para a contabilidade e o movimento no período. */
export interface ContaDoPacote {
  id: number;
  nome: string;
  /** B = banco, C = caixa, D = dividendos. */
  tipo: string;
  ativa: boolean;
  /** `contas.id_planejamento`: o razão em que o movimento dela mora. */
  razaoId: number | null;
  banco: string;
  agencia: string;
  numero: string;
  papel: PapelDaConta;
  /** Lançamentos no razão dela dentro do período. */
  movimentos: number;
}

/** Os anexos que um título já tem no IXC (aba "Arquivos"). */
export interface AnexoDoIxc {
  id: number;
  descricao: string;
  extensao: string;
}

/** O que o item 8 guarda: a lista que os recortes (13, 14, 18, 20) leem. */
export interface DadosDasSaidas {
  pagamentos: Pagamento[];
  anexosIxc: Record<string, AnexoDoIxc[]>;
  lidoEm: string;
}

/** Os grupos de leitura: cada um lê o IXC uma vez e preenche vários itens. */
export type Grupo = 'contas' | 'receber' | 'pagar' | 'estoque' | 'caixa' | 'cartoes' | 'vales' | 'conciliacao';

export const GRUPO_DO_ITEM: Record<number, Grupo> = {
  1: 'contas',
  5: 'estoque',
  6: 'receber',
  7: 'receber',
  8: 'pagar',
  9: 'conciliacao',
  10: 'caixa',
  11: 'caixa',
  12: 'pagar',
  13: 'pagar',
  14: 'pagar',
  15: 'cartoes',
  16: 'receber',
  17: 'vales',
  18: 'pagar',
  19: 'receber',
  20: 'pagar',
};

/** A ordem da leitura completa: as contas primeiro, porque os outros a usam. */
const ORDEM: Grupo[] = ['contas', 'pagar', 'receber', 'caixa', 'estoque', 'cartoes', 'vales', 'conciliacao'];

/** Leitura começada há mais que isto e não terminada morreu com o servidor. */
export const LEITURA_ABANDONADA_MS = 30 * 60 * 1000;

interface Contexto {
  pacoteId: string;
  de: string;
  ate: string;
  lidoEm: Date;
  contas?: ContaDoPacote[];
}

/**
 * Lê o IXC (e o que este sistema guarda) para um pacote, e congela o resultado
 * de cada item.
 *
 * Roda por fora do pedido: um mês de recebimentos são oito páginas do IXC, os
 * títulos em aberto mais vinte, e a leitura inteira leva minutos — muito mais
 * que o minuto que o proxy espera. A tela pede, recebe "lendo", e acompanha.
 */
@Injectable()
export class LeitorDoPacoteService {
  private readonly logger = new Logger(LeitorDoPacoteService.name);
  /** Uma leitura por pacote de cada vez. */
  private readonly emCurso = new Map<string, Promise<void>>();

  constructor(
    private readonly ixc: IxcClient,
    private readonly prisma: PrismaService,
    private readonly configuracao: ConfiguracaoContabilService,
    private readonly fechamento: FechamentoCaixaService,
    private readonly cartoes: CartoesCreditoService,
    private readonly categorias: CategoriasService,
  ) {}

  estaLendo(pacoteId: string): boolean {
    return this.emCurso.has(pacoteId);
  }

  /**
   * Começa a leitura e volta na hora. `grupos` vazio = tudo.
   *
   * Pedida de novo enquanto uma corre, a segunda espera a primeira acabar e
   * então lê: quem mandou um OFX no meio da leitura completa quer a
   * conciliação com ele.
   */
  iniciar(pacoteId: string, grupos: Grupo[] = []): void {
    const anterior = this.emCurso.get(pacoteId) ?? Promise.resolve();
    const leitura = anterior
      .catch(() => undefined)
      .then(() => this.ler(pacoteId, grupos.length ? grupos : ORDEM))
      .catch((e: unknown) =>
        this.logger.error(`Leitura do pacote ${pacoteId} falhou: ${e instanceof Error ? e.stack : String(e)}`),
      )
      .finally(() => {
        if (this.emCurso.get(pacoteId) === leitura) this.emCurso.delete(pacoteId);
      });
    this.emCurso.set(pacoteId, leitura);
  }

  private async ler(pacoteId: string, grupos: Grupo[]): Promise<void> {
    const pacote = await this.prisma.pacoteContabil.findUnique({ where: { id: pacoteId } });
    if (!pacote) return;

    await this.prisma.pacoteContabil.update({
      where: { id: pacoteId },
      data: { leituraEm: new Date(), leituraFimEm: null },
    });

    const ctx: Contexto = {
      pacoteId,
      de: pacote.de.toISOString().slice(0, 10),
      ate: pacote.ate.toISOString().slice(0, 10),
      lidoEm: new Date(),
    };
    const inicio = Date.now();
    this.logger.log(`Pacote ${ctx.de} a ${ctx.ate}: lendo ${grupos.join(', ')}.`);

    // Os grupos vão em sequência: o IXC é um só, e ele é o gargalo.
    for (const grupo of ORDEM.filter((g) => grupos.includes(g))) {
      const comeco = Date.now();
      try {
        await this.lerGrupo(grupo, ctx);
        this.logger.log(`Pacote ${ctx.de} a ${ctx.ate}: ${grupo} em ${Math.round((Date.now() - comeco) / 1000)}s.`);
      } catch (e) {
        const mensagem = e instanceof Error ? e.message : String(e);
        this.logger.error(`Pacote ${ctx.de} a ${ctx.ate}: ${grupo} falhou — ${mensagem}`);
        for (const item of Object.entries(GRUPO_DO_ITEM)
          .filter(([, g]) => g === grupo)
          .map(([i]) => Number(i))) {
          await this.marcarErro(pacoteId, item, '', mensagem);
        }
      }
    }

    await this.prisma.pacoteContabil.update({
      where: { id: pacoteId },
      data: { leituraFimEm: new Date() },
    });
    this.logger.log(`Pacote ${ctx.de} a ${ctx.ate}: leitura terminada em ${Math.round((Date.now() - inicio) / 1000)}s.`);
  }

  private async lerGrupo(grupo: Grupo, ctx: Contexto): Promise<void> {
    switch (grupo) {
      case 'contas':
        return this.lerContas(ctx);
      case 'receber':
        return this.lerReceber(ctx);
      case 'pagar':
        return this.lerPagar(ctx);
      case 'estoque':
        return this.lerEstoque(ctx);
      case 'caixa':
        return this.lerCaixa(ctx);
      case 'cartoes':
        return this.lerCartoes(ctx);
      case 'vales':
        return this.lerVales(ctx);
      case 'conciliacao':
        return this.lerConciliacoes(ctx);
    }
  }

  // -------------------------------------------------------------------------
  // Guardar
  // -------------------------------------------------------------------------

  private async guardar(
    ctx: Contexto,
    item: number,
    chave: string,
    conteudo: { dados: unknown; resumo: unknown; avisos: string[] },
  ): Promise<void> {
    const dados = conteudo.dados as Prisma.InputJsonValue;
    const resumo = conteudo.resumo as Prisma.InputJsonValue;
    await this.prisma.itemDoPacote.upsert({
      where: { pacoteId_item_chave: { pacoteId: ctx.pacoteId, item, chave } },
      create: {
        pacoteId: ctx.pacoteId,
        item,
        chave,
        dados,
        resumo,
        avisos: conteudo.avisos,
        lidoEm: ctx.lidoEm,
        erro: null,
      },
      update: { dados, resumo, avisos: conteudo.avisos, lidoEm: ctx.lidoEm, erro: null },
    });
  }

  private guardarRelatorio(ctx: Contexto, item: number, r: Relatorio, chave = ''): Promise<void> {
    return this.guardar(ctx, item, chave, { dados: { relatorio: r }, resumo: r.resumo, avisos: r.avisos });
  }

  private async marcarErro(pacoteId: string, item: number, chave: string, erro: string): Promise<void> {
    await this.prisma.itemDoPacote.upsert({
      where: { pacoteId_item_chave: { pacoteId, item, chave } },
      create: { pacoteId, item, chave, erro },
      update: { erro },
    });
  }

  // -------------------------------------------------------------------------
  // 1 — As contas, e o movimento de cada uma no período
  // -------------------------------------------------------------------------

  private async contas(ctx: Contexto): Promise<ContaDoPacote[]> {
    if (ctx.contas) return ctx.contas;
    const [cfg, crus] = await Promise.all([
      this.configuracao.obter(),
      lerTudo(this.ixc, { tabela: 'contas', qtype: 'contas.id', query: '0', oper: '>', sortname: 'contas.id' }),
    ]);

    const contas: ContaDoPacote[] = [];
    for (const raw of crus) {
      const id = idDoIxc(raw.id);
      if (id === null) continue;
      const nome = texto(raw.conta) || `Conta ${id}`;
      const tipo = texto(raw.tipo_conta).toUpperCase();
      contas.push({
        id,
        nome,
        tipo,
        ativa: texto(raw.ativo).toUpperCase() === 'S',
        razaoId: idDoIxc(raw.id_planejamento),
        banco: texto(raw.cod_banco),
        agencia: texto(raw.agencia),
        numero: [texto(raw.numero_conta), texto(raw.numero_conta_dv)].filter(Boolean).join('-'),
        papel: cfg.papelDasContas[String(id)] ?? papelSugerido({ nome, tipo }),
        movimentos: 0,
      });
    }

    // Quantos lançamentos cada razão teve no período: a conta sem movimento
    // não precisa de extrato, e a parada há anos nem aparece.
    for (const conta of contas) {
      if (conta.razaoId === null) continue;
      const res = await this.ixc.list<Record<string, unknown>>('fn_movim_finan', {
        qtype: 'fn_movim_finan.id_conta',
        query: String(conta.razaoId),
        oper: '=',
        sortname: 'fn_movim_finan.id',
        sortorder: 'asc',
        rp: 1,
        gridParam: [{ TB: 'fn_movim_finan.data', OP: 'BE', P: ctx.de, P2: ctx.ate }],
      });
      conta.movimentos = res.total;
    }

    ctx.contas = contas;
    return contas;
  }

  private async lerContas(ctx: Contexto): Promise<void> {
    const contas = await this.contas(ctx);
    const doPeriodo = contas.filter((c) => c.movimentos > 0 || c.ativa);
    await this.guardar(ctx, 1, '', {
      dados: { contas: doPeriodo },
      resumo: [],
      avisos: [],
    });
  }

  private async nomesDasContas(ctx: Contexto): Promise<Map<number, string>> {
    return new Map((await this.contas(ctx)).map((c) => [c.id, c.nome]));
  }

  // -------------------------------------------------------------------------
  // 6, 7, 16, 19 — O lado de quem recebe
  // -------------------------------------------------------------------------

  private async lerReceber(ctx: Contexto): Promise<void> {
    const { de, ate } = ctx;
    const recebimento = (grid: Pergunta['grid'], podeVirVazio = false) =>
      lerTudo(
        this.ixc,
        {
          tabela: 'fn_areceber_baixas',
          qtype: 'fn_movim_finan.id_receber',
          query: '0',
          oper: '>',
          // A view só aceita esta ordem: com o padrão (o nome dela) o IXC
          // devolve zero linhas, sem erro. Ver `ixc-leitura`.
          sortname: 'fn_movim_finan.id',
          grid,
        },
        { podeVirVazio },
      );
    const titulos = (grid: Pergunta['grid'], qtype = 'fn_areceber.id', query = '0', oper: Pergunta['oper'] = '>', podeVirVazio = false) =>
      lerTudo(this.ixc, { tabela: 'fn_areceber', qtype, query, oper, sortname: 'fn_areceber.id', grid }, { podeVirVazio });

    const recebidosNoPeriodo = await recebimento([{ TB: 'fn_movim_finan.data', OP: 'BE', P: de, P2: ate }], true);
    const recebidosDepois = await recebimento([{ TB: 'fn_movim_finan.data', OP: '>', P: ate }], true);
    const abertosA = await titulos(undefined, 'fn_areceber.status', 'A', '=', true);
    const abertosP = await titulos(undefined, 'fn_areceber.status', 'P', '=', true);
    const canceladosDepois = await titulos(
      [{ TB: 'fn_areceber.data_cancelamento', OP: '>', P: ate }],
      'fn_areceber.status',
      'C',
      '=',
      true,
    );
    const doServico = await titulos([{ TB: 'fn_areceber.data_inicial', OP: 'BE', P: de, P2: ate }]);
    const emitidos = await titulos([{ TB: 'fn_areceber.data_emissao', OP: 'BE', P: de, P2: ate }]);
    const vendas = await lerTudo(
      this.ixc,
      {
        tabela: 'vd_saida',
        qtype: 'vd_saida.id',
        query: '0',
        oper: '>',
        sortname: 'vd_saida.id',
        grid: [{ TB: 'vd_saida.data_emissao', OP: 'BE', P: de, P2: ate }],
      },
      { podeVirVazio: true },
    );

    const recebimentosDoPeriodo = recebidosNoPeriodo
      .map(lerRecebimento)
      .filter((r): r is Recebimento => r !== null && r.dia >= de && r.dia <= ate);

    // Os títulos que faltam: os recebidos depois do dia que não estão em
    // aberto hoje, e os dos recebimentos do período que vão para o juros e a
    // maquininha (é deles que sai o cliente e o vencimento).
    const conhecidos = new Map<number, Record<string, unknown>>();
    for (const lista of [abertosA, abertosP, canceladosDepois, doServico, emitidos]) {
      for (const raw of lista) {
        const id = idDoIxc(raw.id);
        if (id !== null) conhecidos.set(id, raw);
      }
    }
    const contas = await this.contas(ctx);
    const contasDaMaquininha = contas.filter((c) => c.papel === 'maquininha').map((c) => c.id);
    const precisam = new Set<number>();
    for (const r of recebidosDepois) {
      const id = idDoIxc(r.id_receber);
      if (id !== null && !conhecidos.has(id)) precisam.add(id);
    }
    for (const r of recebimentosDoPeriodo) {
      if ((r.acrescimo > 0 || (r.contaId !== null && contasDaMaquininha.includes(r.contaId))) && !conhecidos.has(r.tituloId)) {
        precisam.add(r.tituloId);
      }
    }
    const faltantes = await lerPorIds(this.ixc, 'fn_areceber', 'fn_areceber.id', precisam);
    for (const raw of faltantes) {
      const id = idDoIxc(raw.id);
      if (id !== null) conhecidos.set(id, raw);
    }

    // Os clientes de todos eles, de uma vez.
    const idsDeCliente = new Set<number>();
    for (const raw of [...conhecidos.values(), ...vendas]) {
      const id = idDoIxc(raw.id_cliente);
      if (id !== null) idsDeCliente.add(id);
    }
    const clientesCrus = await lerPorIds(this.ixc, 'cliente', 'cliente.id', idsDeCliente);
    const clientes = new Map<number, { nome: string; documento: string }>();
    for (const raw of clientesCrus) {
      const id = idDoIxc(raw.id);
      if (id === null) continue;
      clientes.set(id, { nome: texto(raw.razao) || texto(raw.fantasia), documento: texto(raw.cnpj_cpf) });
    }
    const cadastros: Cadastros = { clientes, contas: await this.nomesDasContas(ctx) };

    const abertosHoje = [...abertosA, ...abertosP];
    const idsAbertos = new Set(abertosHoje.map((r) => idDoIxc(r.id)));
    const titulosRecebidosDepois: Array<Record<string, unknown>> = [];
    for (const r of recebidosDepois) {
      const id = idDoIxc(r.id_receber);
      if (id === null || idsAbertos.has(id)) continue;
      const raw = conhecidos.get(id);
      if (raw) titulosRecebidosDepois.push(raw);
    }

    await this.guardarRelatorio(
      ctx,
      6,
      relatorioDeClientes({
        dia: ate,
        abertosHoje,
        recebidosDepois,
        titulosRecebidosDepois: [...new Map(titulosRecebidosDepois.map((r) => [idDoIxc(r.id), r])).values()],
        canceladosDepois,
        clientes,
        lidoEm: ctx.lidoEm,
      }),
    );
    await this.guardarRelatorio(
      ctx,
      7,
      relatorioDeFaturamento({
        de,
        ate,
        titulosDoServico: doServico,
        titulosEmitidos: emitidos,
        vendas,
        recebimentos: recebimentosDoPeriodo,
        cadastros,
        lidoEm: ctx.lidoEm,
      }),
    );
    await this.guardarRelatorio(
      ctx,
      19,
      relatorioDeJuros({ de, ate, recebimentos: recebimentosDoPeriodo, titulos: conhecidos, cadastros, lidoEm: ctx.lidoEm }),
    );
    await this.guardarRelatorio(
      ctx,
      16,
      relatorioDeVendasNoCartao({
        de,
        ate,
        contas: contasDaMaquininha,
        recebimentos: recebimentosDoPeriodo,
        titulos: conhecidos,
        cadastros,
        lidoEm: ctx.lidoEm,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // 8 e 12 (e os recortes 13, 14, 18, 20) — O lado de quem paga
  // -------------------------------------------------------------------------

  private async lerPagar(ctx: Contexto): Promise<void> {
    const { de, ate } = ctx;
    const titulos = (grid: Pergunta['grid'], qtype = 'fn_apagar.id', query = '0', oper: Pergunta['oper'] = '>') =>
      lerTudo(this.ixc, { tabela: 'fn_apagar', qtype, query, oper, sortname: 'fn_apagar.id', grid }, { podeVirVazio: true });

    const pagosCrus = (await titulos([{ TB: 'fn_apagar.debito_data', OP: 'BE', P: de, P2: ate }])).filter((r) =>
      foiPagoNoPeriodo(r, de, ate),
    );
    const abertosA = await titulos(undefined, 'fn_apagar.status', 'A', '=');
    const abertosP = await titulos(undefined, 'fn_apagar.status', 'P', '=');
    const pagosDepois = await titulos([{ TB: 'fn_apagar.debito_data', OP: '>', P: ate }]);
    const canceladosDepois = await titulos(
      [{ TB: 'fn_apagar.data_cancelamento', OP: '>', P: ate }],
      'fn_apagar.status',
      'C',
      '=',
    );
    // A tabela de contas a pagar nunca está vazia nesta casa: se as quatro
    // perguntas vierem vazias, alguma coluna deixou de existir.
    if (pagosCrus.length + abertosA.length + abertosP.length + pagosDepois.length === 0) {
      await lerTudo(this.ixc, { tabela: 'fn_apagar', qtype: 'fn_apagar.status', query: 'A', oper: '=', sortname: 'fn_apagar.id' });
    }

    const todos = [...pagosCrus, ...abertosA, ...abertosP, ...pagosDepois, ...canceladosDepois];
    const idsFornecedor = new Set<number>();
    const idsPlano = new Set<number>();
    for (const raw of todos) {
      const f = idDoIxc(raw.id_fornecedor);
      const p = idDoIxc(raw.id_conta);
      if (f !== null) idsFornecedor.add(f);
      if (p !== null) idsPlano.add(p);
    }
    const [fornecedoresCrus, planosCrus] = [
      await lerPorIds(this.ixc, 'fornecedor', 'fornecedor.id', idsFornecedor),
      await lerPorIds(this.ixc, 'planejamento_analitico', 'planejamento_analitico.id', idsPlano),
    ];
    const cad: CadastrosDoPagar = {
      fornecedores: new Map(
        fornecedoresCrus
          .map((r) => [idDoIxc(r.id), { nome: texto(r.razao) || texto(r.fantasia), documento: texto(r.cpf_cnpj) }] as const)
          .filter((x): x is [number, { nome: string; documento: string }] => x[0] !== null),
      ),
      contas: await this.nomesDasContas(ctx),
      planoDeContas: new Map(
        planosCrus
          .map((r) => [idDoIxc(r.id), texto(r.planejamento_analitico)] as const)
          .filter((x): x is [number, string] => x[0] !== null),
      ),
    };

    const pagamentos = pagosCrus.map((r) => lerPagamento(r, cad)).filter((p): p is Pagamento => p !== null);
    const ids = pagamentos.map((p) => p.idFnApagar);

    // As categorias desta casa: a etiqueta do título e, na fatura e na conta
    // de várias notas, as das partes.
    const [etiquetas, rateios] = await Promise.all([this.categorias.dosTitulos(ids), this.categorias.rateiosDosTitulos(ids)]);
    for (const p of pagamentos) {
      const vistas = new Map<string, string>();
      const etiqueta = etiquetas.get(p.idFnApagar);
      if (etiqueta) vistas.set(etiqueta.id, etiqueta.grupo ? `${etiqueta.grupo.nome} › ${etiqueta.nome}` : etiqueta.nome);
      for (const fatia of rateios.get(p.idFnApagar) ?? []) {
        const c = fatia.classificacao;
        if (c) vistas.set(c.id, c.grupo ? `${c.grupo.nome} › ${c.nome}` : c.nome);
      }
      p.categorias = [...vistas.entries()].map(([id, nome]) => ({ id, nome }));
      const grupos = [etiqueta?.grupo, ...(rateios.get(p.idFnApagar) ?? []).map((f) => f.classificacao?.grupo)];
      p.categoriaIds = [...new Set([...vistas.keys(), ...grupos.filter((g) => !!g).map((g) => g!.id)])];
    }

    // O lançamento do dinheiro de cada pagamento no razão da conta. A perna
    // "P" do `fn_movim_finan` traz o título em `documento` e o lançamento do
    // dinheiro em `id_movim_finan` — é por ele que a foto da nota tirada no
    // fechamento de caixa chega ao pagamento.
    const pernas = await lerTudo(
      this.ixc,
      {
        tabela: 'fn_movim_finan',
        qtype: 'fn_movim_finan.tipo_lanc',
        query: 'P',
        oper: '=',
        sortname: 'fn_movim_finan.id',
        grid: [{ TB: 'fn_movim_finan.data', OP: 'BE', P: de, P2: ate }],
      },
      { podeVirVazio: true },
    );
    const movimentoDoTitulo = new Map<number, number>();
    for (const perna of pernas) {
      const titulo = idDoIxc(perna.documento);
      const movimento = idDoIxc(perna.id_movim_finan);
      if (titulo !== null && movimento !== null) movimentoDoTitulo.set(titulo, movimento);
    }
    for (const p of pagamentos) p.idMovimento = movimentoDoTitulo.get(p.idFnApagar) ?? null;

    // Os anexos que os títulos já têm no IXC.
    const anexosCrus = await lerPorIds(this.ixc, 'fn_apagar_arquivos', 'fn_apagar_arquivos.id_apagar', ids);
    const anexosIxc: Record<string, AnexoDoIxc[]> = {};
    for (const raw of anexosCrus) {
      const titulo = idDoIxc(raw.id_apagar);
      const id = idDoIxc(raw.id);
      if (titulo === null || id === null) continue;
      (anexosIxc[String(titulo)] ??= []).push({
        id,
        descricao: texto(raw.descricao) || 'Nota',
        extensao: texto(raw.extensao).replace('.', '').toLowerCase(),
      });
    }

    const dados: DadosDasSaidas = { pagamentos, anexosIxc, lidoEm: ctx.lidoEm.toISOString() };
    await this.guardar(ctx, 8, '', { dados, resumo: [], avisos: [] });

    await this.guardarRelatorio(
      ctx,
      12,
      relatorioDeFornecedores({
        dia: ate,
        abertosHoje: [...abertosA, ...abertosP],
        pagosDepois,
        canceladosDepois,
        cadastros: cad,
        lidoEm: ctx.lidoEm,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // 5 — Estoque
  // -------------------------------------------------------------------------

  private async lerEstoque(ctx: Contexto): Promise<void> {
    const { ate } = ctx;
    const produtos = await lerTudo(this.ixc, {
      tabela: 'produtos',
      qtype: 'produtos.id',
      query: '0',
      oper: '>',
      sortname: 'produtos.id',
    });
    const saldos = await lerTudo(this.ixc, {
      tabela: 'estoque_produtos_almox_filial',
      qtype: 'estoque_produtos_almox_filial.id',
      query: '0',
      oper: '>',
      sortname: 'estoque_produtos_almox_filial.id',
    });
    const movimentosDepois = await lerTudo(
      this.ixc,
      {
        tabela: 'movimento_produtos',
        qtype: 'movimento_produtos.id',
        query: '0',
        oper: '>',
        sortname: 'movimento_produtos.id',
        grid: [{ TB: 'movimento_produtos.data', OP: '>', P: ate }],
      },
      { podeVirVazio: true },
    );
    const almoxCrus = await lerTudo(
      this.ixc,
      { tabela: 'almox', qtype: 'almox.id', query: '0', oper: '>', sortname: 'almox.id' },
      { podeVirVazio: true },
    );
    const unidadesCruas = await lerTudo(
      this.ixc,
      { tabela: 'unidades', qtype: 'unidades.id', query: '0', oper: '>', sortname: 'unidades.id' },
      { podeVirVazio: true },
    );
    const almoxarifados = new Map<number, string>();
    for (const a of almoxCrus) {
      const id = idDoIxc(a.id);
      if (id !== null) almoxarifados.set(id, texto(a.descricao));
    }
    const unidades = new Map<number, string>();
    for (const u of unidadesCruas) {
      const id = idDoIxc(u.id);
      if (id !== null) unidades.set(id, texto(u.sigla) || texto(u.descricao));
    }

    // As compras de verdade (entrada de nota, com preço de R$ 0,10 para cima),
    // todas de uma vez: são quatro mil e poucas linhas, cinco páginas — contra
    // uma pergunta ao IXC por produto. Fica a última de cada um até o dia.
    const compras = await lerTudo(
      this.ixc,
      {
        tabela: 'movimento_produtos',
        qtype: 'movimento_produtos.tipo',
        query: 'E',
        oper: '=',
        sortname: 'movimento_produtos.id',
        grid: [
          { TB: 'movimento_produtos.id_entrada', OP: '>', P: '0' },
          { TB: 'movimento_produtos.valor_unitario', OP: '>=', P: String(MENOR_CUSTO_DE_VERDADE) },
        ],
      },
      { podeVirVazio: true },
    );
    const ultimaCompra = new Map<number, { valor: number; dia: string | null; id: number }>();
    for (const c of compras) {
      const produtoId = idDoIxc(c.id_produto);
      const id = idDoIxc(c.id) ?? 0;
      const dia = diaDoIxc(c.data);
      const valor = numero(c.valor_unitario);
      if (produtoId === null || !dia || dia > ate || valor < MENOR_CUSTO_DE_VERDADE) continue;
      const atual = ultimaCompra.get(produtoId);
      // A mais nova pelo dia; no mesmo dia, a lançada por último.
      if (!atual || dia > (atual.dia ?? '') || (dia === atual.dia && id > atual.id)) {
        ultimaCompra.set(produtoId, { valor, dia, id });
      }
    }

    await this.guardarRelatorio(
      ctx,
      5,
      relatorioDeEstoque({ dia: ate, produtos, saldos, movimentosDepois, almoxarifados, unidades, lidoEm: ctx.lidoEm, ultimaCompra }),
    );
  }

  // -------------------------------------------------------------------------
  // 10 e 11 — O caixa físico
  // -------------------------------------------------------------------------

  private async lerCaixa(ctx: Contexto): Promise<void> {
    const contas = await this.contas(ctx);
    const caixas = contas.filter((c) => c.papel === 'caixa' && c.movimentos > 0);

    const lidos: CaixaNoPeriodo[] = [];
    for (const caixa of caixas) {
      const extrato = await this.fechamento.extrato(caixa.id, ctx.de, ctx.ate);
      lidos.push({
        caixaId: caixa.id,
        nome: caixa.nome,
        lancamentos: extrato.lancamentos.map((l) => ({
          id: l.id,
          data: l.data.toISOString().slice(0, 10),
          valor: l.valor,
          historico: l.historico,
          tipo: l.tipo,
          conferido: l.conferido,
          qtdNotas: l.qtdNotas,
          observacao: l.observacao,
          foraDaGaveta: l.foraDaGaveta,
          motivoForaDaGaveta: l.motivoForaDaGaveta,
        })),
        saldoInicial: extrato.resumo.saldoInicial,
        fechadoAte: extrato.resumo.saldoInicial !== null ? extrato.resumo.fechadoAte : null,
        saldoCalculadoNoFim: extrato.resumo.saldoEsperado,
        fechamentos: extrato.fechamentos.map((f) => ({
          de: f.de.toISOString().slice(0, 10),
          ate: f.ate.toISOString().slice(0, 10),
          saldoInicial: Number(f.saldoInicial),
          saldoFinal: Number(f.saldoFinal),
          saldoContado: f.saldoContado === null ? null : Number(f.saldoContado),
          totalNaRua: Number(f.totalNaRua),
          totalEntradas: Number(f.totalEntradas),
          totalSaidas: Number(f.totalSaidas),
          conferidos: f.conferidos,
          lancamentos: f.lancamentos,
          fechadoPor: f.fechadoPor,
        })),
        informado: null,
      });
    }

    await this.guardar(ctx, 10, '', { dados: { caixas: lidos }, resumo: [], avisos: [] });
  }

  // -------------------------------------------------------------------------
  // 15 — Cartão de crédito
  // -------------------------------------------------------------------------

  private async lerCartoes(ctx: Contexto): Promise<void> {
    const meses: string[] = [];
    for (let m = ctx.de.slice(0, 7); m <= ctx.ate.slice(0, 7); ) {
      meses.push(m);
      const [a, mm] = m.split('-').map(Number);
      m = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}`;
    }

    const categorias = new Map(
      (await this.prisma.categoriaDespesa.findMany({ select: { id: true, nome: true } })).map((c) => [c.id, c.nome]),
    );

    const faturas: FaturaDoPeriodo[] = [];
    for (const competencia of meses) {
      const { cartoes } = await this.cartoes.listar(competencia);
      for (const c of cartoes) {
        if (c.itens.length === 0 && !c.lancada) continue;
        const vencimento = (c.lancada?.dataVencimento ?? c.vencimentoSugerido).toISOString().slice(0, 10);
        // A fatura conta no período pelo vencimento dela.
        if (vencimento < ctx.de || vencimento > ctx.ate) continue;
        const lancada = c.lancada;
        faturas.push({
          cartaoId: c.cartao.id,
          cartao: c.cartao.final ? `${c.cartao.apelido} (final ${c.cartao.final})` : c.cartao.apelido,
          competencia,
          vencimento,
          total: lancada ? lancada.valor : c.total,
          situacao: !lancada
            ? 'Não lançada no sistema'
            : lancada.status === StatusContaPagar.PAGO && lancada.pagoEm
              ? `Paga em ${lancada.pagoEm.toISOString().slice(0, 10).split('-').reverse().join('/')}`
              : 'Lançada, não paga',
          compras: c.itens.map((i) => ({
            descricao: i.descricao,
            parcela: i.assinatura ? 'mensal' : `${i.parcela}/${i.parcelas}`,
            valor: i.valor,
            categoria: i.categoriaId ? (categorias.get(i.categoriaId) ?? '') : '',
          })),
        });
      }
    }

    const r = relatorioDeCartoes({ de: ctx.de, ate: ctx.ate, faturas });
    await this.guardar(ctx, 15, '', {
      dados: { relatorio: r, faturas: faturas.map((f) => ({ cartaoId: f.cartaoId, cartao: f.cartao, competencia: f.competencia, total: f.total })) },
      resumo: r.resumo,
      avisos: r.avisos,
    });
  }

  // -------------------------------------------------------------------------
  // 17 — Vales e adiantamentos
  // -------------------------------------------------------------------------

  private async lerVales(ctx: Contexto): Promise<void> {
    const { de, ate } = ctx;
    const inicio = new Date(`${de}T00:00:00.000Z`);
    const fim = new Date(`${ate}T23:59:59.999Z`);
    const lista: AdiantamentoAoFuncionario[] = [];

    // O adiantamento de salário lançado no IXC (Folha > Adiantamento de salários).
    const doIxc = await lerTudo(
      this.ixc,
      {
        tabela: 'fl_adto_salario',
        qtype: 'fl_adto_salario.id',
        query: '0',
        oper: '>',
        sortname: 'fl_adto_salario.id',
        grid: [{ TB: 'fl_adto_salario.data', OP: 'BE', P: de, P2: ate }],
      },
      { podeVirVazio: true },
    );
    const funcionarios = await this.prisma.funcionario.findMany({
      select: { id: true, ixcId: true, nome: true, cpfCnpj: true, carteiraAssinada: true },
    });
    const porIxc = new Map(funcionarios.filter((f) => f.ixcId !== null).map((f) => [f.ixcId as number, f]));
    const nomesDasContas = await this.nomesDasContas(ctx);
    for (const raw of doIxc) {
      const dia = diaDoIxc(raw.data);
      if (!dia || dia < de || dia > ate) continue;
      const f = porIxc.get(idDoIxc(raw.id_funcionario) ?? 0);
      const conta = idDoIxc(raw.conta_);
      const tipo = texto(raw.tipo_pagamento).toUpperCase();
      lista.push({
        origem: 'Adiantamento de salário lançado no IXC',
        funcionario: f?.nome ?? `Funcionário ${texto(raw.id_funcionario)} no IXC`,
        cpf: f?.cpfCnpj ?? '',
        carteiraAssinada: f ? f.carteiraAssinada : null,
        dia,
        descricao: texto(raw.descricao),
        valor: centavos(numero(raw.valor)),
        forma: [tipo === 'D' ? 'Dinheiro' : tipo === 'C' ? 'Cheque' : tipo, conta !== null ? (nomesDasContas.get(conta) ?? `Conta ${conta}`) : '']
          .filter(Boolean)
          .join(' · '),
        descontaNaFolha: '',
      });
    }

    // O vale lançado aqui: o funcionário deve à empresa.
    const vales = await this.prisma.vale.findMany({
      where: { cancelado: false, sentido: 'DESCONTO', data: { gte: inicio, lte: fim } },
      include: { funcionario: { select: { nome: true, cpfCnpj: true, carteiraAssinada: true } } },
    });
    for (const v of vales) {
      lista.push({
        origem: 'Vale lançado no sistema',
        funcionario: v.funcionario.nome,
        cpf: v.funcionario.cpfCnpj ?? '',
        carteiraAssinada: v.funcionario.carteiraAssinada,
        dia: v.data.toISOString().slice(0, 10),
        descricao:
          v.quantidadeParcelas > 1 ? `${v.descricao} (em ${v.quantidadeParcelas} parcelas)` : v.descricao,
        valor: centavos(Number(v.valorTotal)),
        forma: '',
        descontaNaFolha: v.descontarDaFolha ? 'Sim' : 'Não (acerto por fora)',
      });
    }

    // O adiantamento do dia 25 de quem não tem carteira assinada: esse a
    // folha da contabilidade não conhece.
    const adiantamentos = await this.prisma.contaPagar.findMany({
      where: {
        tipo: TipoLancamento.ADIANTAMENTO,
        status: StatusContaPagar.PAGO,
        pagoEm: { gte: inicio, lte: fim },
        funcionario: { carteiraAssinada: false },
      },
      include: { funcionario: { select: { nome: true, cpfCnpj: true } } },
    });
    for (const a of adiantamentos) {
      lista.push({
        origem: 'Adiantamento do dia 25 (sem carteira assinada)',
        funcionario: a.funcionario?.nome ?? a.beneficiarioNome,
        cpf: a.funcionario?.cpfCnpj ?? '',
        carteiraAssinada: false,
        dia: (a.pagoEm ?? a.dataVencimento).toISOString().slice(0, 10),
        descricao: a.competencia ? `Adiantamento ${a.competencia.slice(5)}/${a.competencia.slice(0, 4)}` : 'Adiantamento',
        valor: centavos(Number(a.valor)),
        forma: a.tipoPagamentoIxc ?? '',
        descontaNaFolha: 'Sim',
      });
    }

    await this.guardarRelatorio(ctx, 17, relatorioDeVales({ de, ate, adiantamentos: lista }));
  }

  // -------------------------------------------------------------------------
  // 9 — Conciliação bancária
  // -------------------------------------------------------------------------

  private async lerConciliacoes(ctx: Contexto): Promise<void> {
    const contas = await this.contas(ctx);
    const ofxs = await this.prisma.arquivoContabil.findMany({
      where: { pacoteId: ctx.pacoteId, item: 1, chave: { endsWith: ':ofx' } },
      orderBy: { createdAt: 'desc' },
    });

    // A conciliação que ficou sem OFX (apagado) sai daqui.
    const comOfx = new Set<string>();
    for (const arquivo of ofxs) {
      const contaId = Number(arquivo.chave.split(':')[1]);
      const chave = `conta:${contaId}`;
      if (comOfx.has(chave)) continue; // o mais novo vale
      comOfx.add(chave);
      const conta = contas.find((c) => c.id === contaId);
      try {
        if (!conta || conta.razaoId === null) throw new Error('Esta conta não existe mais no IXC.');
        const extrato = lerOfx(Buffer.from(arquivo.conteudo));
        const movimento = await lerTudo(
          this.ixc,
          {
            tabela: 'fn_movim_finan',
            qtype: 'fn_movim_finan.id_conta',
            query: String(conta.razaoId),
            oper: '=',
            sortname: 'fn_movim_finan.id',
            grid: [{ TB: 'fn_movim_finan.data', OP: 'BE', P: ctx.de, P2: ctx.ate }],
          },
          { podeVirVazio: true },
        );
        const r = relatorioDeConciliacao({
          conta: conta.nome,
          de: ctx.de,
          ate: ctx.ate,
          extrato,
          arquivoOfx: arquivo.nome,
          ixc: movimento.map(lerLancamentoDoIxc).filter((l): l is NonNullable<typeof l> => l !== null),
          lidoEm: ctx.lidoEm,
        });
        await this.guardarRelatorio(ctx, 9, r, chave);
      } catch (e) {
        await this.marcarErro(ctx.pacoteId, 9, chave, e instanceof Error ? e.message : String(e));
      }
    }

    await this.prisma.itemDoPacote.deleteMany({
      where: { pacoteId: ctx.pacoteId, item: 9, chave: { startsWith: 'conta:', notIn: [...comOfx] } },
    });
  }
}
