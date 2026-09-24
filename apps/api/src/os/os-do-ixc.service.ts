import { Injectable, Logger } from '@nestjs/common';
import { numeroDoIxc } from '../almoxarifado/estoque.mapper';
import { identidadeDaPeca } from '../almoxarifado/mover-tudo';
import { hojeParaIxc } from '../almoxarifado/produtos-ixc';
import { ProdutosService } from '../almoxarifado/produtos.service';
import { IxcClient } from '../ixc/ixc.client';
import {
  DIAS_DEPOIS_DE_FINALIZADA,
  lerComodato,
  lerOs,
  osRecusaMaterial,
  produtoParaOs,
  type ComodatoDoContrato,
  type OsDoIxc,
  type ProdutoParaOs,
} from './os-ixc';

/** Quanto valem os cadastros que quase não mudam (assuntos, filiais). */
const CADASTRO_VALE_MS = 30 * 60_000;

/** Uma peça de patrimônio na prateleira de um almoxarifado. */
export interface AparelhoNoAlmox {
  patrimonioId: number;
  produtoId: number;
  descricao: string;
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
  /** "1" Disponível ou "7" Disponível Técnico — vai no comodato como a situação de antes. */
  situacao: string;
}

/**
 * As leituras do IXC que as ordens de serviço fazem. Só leitura: o que se
 * escreve está em `OsService`, e o corpo de cada escrita em `os-ixc.ts`.
 *
 * Nada aqui guarda o que muda durante o dia (a OS, o saldo da van, o
 * comodato): a tela do técnico é a hora de conferir, e conferir com o que o
 * IXC tinha há dez minutos é não conferir. Só os cadastros que quase não mudam
 * — o nome dos assuntos e das filiais — ficam guardados.
 */
@Injectable()
export class OsDoIxcService {
  private readonly logger = new Logger(OsDoIxcService.name);
  private assuntos: { em: number; nomes: Map<number, string> } | null = null;
  private filiais: { em: number; nomes: Map<number, string> } | null = null;

  constructor(
    private readonly ixc: IxcClient,
    private readonly produtos: ProdutosService,
  ) {}

  /**
   * As OS do técnico: as que não estão finalizadas, e as finalizadas nos
   * últimos dias — o técnico que lança o material depois de o atendimento
   * finalizar a OS ainda tem onde lançar (ver `DIAS_DEPOIS_DE_FINALIZADA`).
   */
  async doTecnico(tecnicoIxcId: number, agora = new Date()): Promise<OsDoIxc[]> {
    const doTecnico = {
      qtype: 'su_oss_chamado.id_tecnico',
      query: String(tecnicoIxcId),
      oper: '=' as const,
      sortname: 'su_oss_chamado.id',
      sortorder: 'desc' as const,
    };
    /*
     * A data vai "AAAA-MM-DD", e não "DD/MM/AAAA" como nos exemplos da
     * documentação: com o formato de lá o IXC não reclama, mas também não
     * filtra — devolveu 7.392 OS finalizadas de um técnico em vez das 17 dos
     * últimos dias (visto na base em 24/09/2026).
     */
    const desde = hojeParaIxc(new Date(agora.getTime() - DIAS_DEPOIS_DE_FINALIZADA * 86_400_000))
      .split('/')
      .reverse()
      .join('-');
    const [abertas, finalizadas] = await Promise.all([
      this.ixc.listAll<Record<string, unknown>>(
        'su_oss_chamado',
        { ...doTecnico, gridParam: [{ TB: 'su_oss_chamado.status', OP: '!=', P: 'F' }] },
        { pageSize: 200, maxPages: 3 },
      ),
      this.ixc
        .list<Record<string, unknown>>('su_oss_chamado', {
          ...doTecnico,
          rp: 50,
          gridParam: [
            { TB: 'su_oss_chamado.status', OP: '=', P: 'F' },
            { TB: 'su_oss_chamado.data_fechamento', OP: '>', P: `${desde} 00:00:00` },
          ],
        })
        .then((r) => r.registros)
        // As recém-finalizadas são um favor; sem elas a lista das abertas vale.
        .catch((e: unknown) => {
          this.logger.warn(`Sem as OS recém-finalizadas do técnico ${tecnicoIxcId} (${motivo(e)}).`);
          return [] as Array<Record<string, unknown>>;
        }),
    ]);

    const porId = new Map<number, OsDoIxc>();
    for (const linha of [...abertas, ...finalizadas]) {
      const os = lerOs(linha);
      // O filtro vai ao IXC, e a conferência fica aqui também: OS de outro
      // técnico na lista deste é o engano que não pode acontecer — e a
      // finalizada há mais tempo não tem o que fazer aqui.
      if (os && os.tecnicoId === tecnicoIxcId && (os.status !== 'F' || !osRecusaMaterial(os, agora))) {
        porId.set(os.id, os);
      }
    }
    return [...porId.values()];
  }

  /** Uma OS pelo número. Null quando não existe (ou o sistema não a enxerga). */
  async os(osId: number): Promise<OsDoIxc | null> {
    const linha = await this.ixc.getById<Record<string, unknown>>(
      'su_oss_chamado',
      'su_oss_chamado.id',
      osId,
    );
    return linha ? lerOs(linha) : null;
  }

  /** id → nome do assunto ("Instalação", "Troca de equipamento"). */
  async nomesDosAssuntos(): Promise<Map<number, string>> {
    if (this.assuntos && Date.now() - this.assuntos.em < CADASTRO_VALE_MS) {
      return this.assuntos.nomes;
    }
    try {
      const linhas = await this.ixc.listAll<Record<string, unknown>>(
        'su_oss_assunto',
        {
          qtype: 'su_oss_assunto.id',
          query: '0',
          oper: '>',
          sortname: 'su_oss_assunto.id',
          sortorder: 'asc',
        },
        { pageSize: 500, maxPages: 4 },
      );
      const nomes = new Map<number, string>();
      for (const l of linhas) {
        const id = numeroDoIxc(l.id);
        const nome = String(l.assunto ?? l.descricao ?? '').trim();
        if (id > 0 && nome) nomes.set(id, nome);
      }
      this.assuntos = { em: Date.now(), nomes };
      return nomes;
    } catch (e) {
      // Sem o nome, a OS aparece com o número do assunto — continua usável.
      this.logger.warn(`Sem os assuntos de OS do IXC (${motivo(e)}).`);
      return this.assuntos?.nomes ?? new Map();
    }
  }

  /** id → nome da filial. É o rótulo que a baixa de comodato leva junto. */
  async nomeDaFilial(filialId: number): Promise<string> {
    if (!this.filiais || Date.now() - this.filiais.em >= CADASTRO_VALE_MS) {
      try {
        const linhas = await this.ixc.listAll<Record<string, unknown>>(
          'filial',
          { qtype: 'filial.id', query: '0', oper: '>', sortname: 'filial.id', sortorder: 'asc' },
          { pageSize: 200, maxPages: 2 },
        );
        const nomes = new Map<number, string>();
        for (const f of linhas) {
          const id = numeroDoIxc(f.id);
          const nome = String(f.filial ?? f.razao_social ?? f.fantasia ?? '').trim();
          if (id > 0 && nome) nomes.set(id, nome);
        }
        this.filiais = { em: Date.now(), nomes };
      } catch (e) {
        this.logger.warn(`Sem as filiais do IXC (${motivo(e)}).`);
      }
    }
    return this.filiais?.nomes.get(filialId) ?? `Filial ${filialId}`;
  }

  /** id → nome, dos clientes pedidos. Um a um: são as poucas OS de um técnico. */
  async nomesDosClientes(ids: number[]): Promise<Map<number, string>> {
    const unicos = [...new Set(ids)].filter((id) => id > 0);
    const achados = await Promise.all(
      unicos.map((id) =>
        this.ixc.getById<Record<string, unknown>>('cliente', 'cliente.id', id).catch(() => null),
      ),
    );
    const nomes = new Map<number, string>();
    achados.forEach((c, i) => {
      const nome = String(c?.razao ?? c?.fantasia ?? '').trim();
      if (nome) nomes.set(unicos[i], nome);
    });
    return nomes;
  }

  /**
   * O que está em comodato no contrato ("Comodato - Produto (listar)", só as
   * linhas emprestadas). É daqui que o técnico escolhe o aparelho que retirou.
   */
  async comodatosDoContrato(contratoId: number): Promise<ComodatoDoContrato[]> {
    if (contratoId <= 0) return [];
    const linhas = await this.ixc.listAll<Record<string, unknown>>(
      'cliente_contrato_comodato',
      {
        qtype: 'movimento_produtos.id_contrato',
        query: String(contratoId),
        oper: '=',
        sortname: 'movimento_produtos.id',
        sortorder: 'asc',
        gridParam: [{ TB: 'movimento_produtos.status_comodato', OP: '=', P: 'E' }],
      },
      { pageSize: 200, maxPages: 3 },
    );
    return linhas
      .map(lerComodato)
      .filter((c): c is ComodatoDoContrato => c !== null && c.status === 'E');
  }

  /** Uma linha de comodato pelo id, em qualquer situação — a releitura depois da baixa. */
  async comodato(comodatoId: number): Promise<ComodatoDoContrato | null> {
    const linha = await this.ixc.getById<Record<string, unknown>>(
      'cliente_contrato_comodato',
      'movimento_produtos.id',
      comodatoId,
    );
    return linha ? lerComodato(linha) : null;
  }

  /** As linhas de comodato presas a uma OS — para achar a que nasceu de uma instalação. */
  async comodatosDaOs(osId: number): Promise<Array<{ id: number; patrimonioId: number }>> {
    const linhas = await this.ixc.listAll<Record<string, unknown>>(
      'su_oss_mov_comodato_wiz',
      {
        qtype: 'movimento_produtos.id_oss_chamado',
        query: String(osId),
        oper: '=',
        sortname: 'movimento_produtos.id',
        sortorder: 'asc',
      },
      { pageSize: 200, maxPages: 2 },
    );
    return linhas
      .map((l) => ({ id: numeroDoIxc(l.id), patrimonioId: numeroDoIxc(l.id_patrimonio) }))
      .filter((l) => l.id > 0);
  }

  /**
   * Os produtos gastos numa OS — para saber se um lançamento que deu erro
   * entrou.
   *
   * Lidos de `movimento_produtos`, e não da listagem de `su_oss_mov_produto`:
   * nesta base ela **ignora o filtro por OS** e devolve zero até para OS que
   * têm linha (visto em 24/09/2026, OS 92279). Confiar nela diria "não gravou"
   * de um material que gravou, e a próxima tentativa o tiraria duas vezes da
   * van. `movimento_produtos` filtra pela OS certo, mas não devolve o
   * `status_comodato`: o comodato da mesma OS sai pelo tipo do produto (P).
   */
  async materiaisDaOs(
    osId: number,
  ): Promise<Array<{ id: number; produtoId: number; quantidade: number }>> {
    const linhas = await this.ixc.listAll<Record<string, unknown>>(
      'movimento_produtos',
      {
        qtype: 'movimento_produtos.id_oss_chamado',
        query: String(osId),
        oper: '=',
        sortname: 'movimento_produtos.id',
        sortorder: 'asc',
      },
      { pageSize: 200, maxPages: 2 },
    );
    return linhas
      .filter((l) => String(l.tipo_produto ?? '').trim().toUpperCase() !== 'P')
      .map((l) => ({
        id: numeroDoIxc(l.id),
        produtoId: numeroDoIxc(l.id_produto),
        quantidade: numeroDoIxc(l.qtde_saida),
      }))
      .filter((l) => l.id > 0 && l.produtoId > 0);
  }

  /**
   * Os aparelhos na prateleira do almoxarifado: 1 Disponível e 7 Disponível
   * Técnico. Uma consulta por situação, como a Transferência faz — pedir todas
   * as peças do almoxarifado traria o histórico inteiro de comodato junto.
   */
  async aparelhosNoAlmox(almoxId: number): Promise<AparelhoNoAlmox[]> {
    const porSituacao = await Promise.all(
      ['1', '7'].map((situacao) =>
        this.ixc.listAll<Record<string, unknown>>(
          'patrimonio',
          {
            qtype: 'patrimonio.id_almoxarifado',
            query: String(almoxId),
            oper: '=',
            sortname: 'patrimonio.id',
            sortorder: 'asc',
            gridParam: [{ TB: 'patrimonio.situacao', OP: '=', P: situacao }],
          },
          { pageSize: 500, maxPages: 4 },
        ),
      ),
    );
    const linhas = porSituacao.flat();
    const cadastros = await this.produtos.cadastrosPorId(
      linhas.map((l) => numeroDoIxc(l.id_produto)),
    );
    const porId = new Map<number, AparelhoNoAlmox>();
    for (const l of linhas) {
      const peca = identidadeDaPeca(l);
      const produtoId = numeroDoIxc(l.id_produto);
      if (peca.patrimonioId <= 0 || produtoId <= 0) continue;
      const cadastro = cadastros.get(produtoId);
      if (String(cadastro?.ativo ?? 'S').trim().toUpperCase() === 'N') continue;
      porId.set(peca.patrimonioId, {
        ...peca,
        situacao: String(l.situacao ?? '').trim(),
        produtoId,
        descricao:
          String(cadastro?.descricao ?? l.descricao ?? '').trim() || `Produto ${produtoId}`,
      });
    }
    return [...porId.values()].sort(
      (a, b) =>
        a.descricao.localeCompare(b.descricao, 'pt-BR') ||
        (a.mac ?? '').localeCompare(b.mac ?? '', 'pt-BR'),
    );
  }

  /** Uma peça pelo id, crua — a releitura depois de instalar. */
  patrimonio(patrimonioId: number): Promise<Record<string, unknown> | null> {
    return this.ixc.getById<Record<string, unknown>>('patrimonio', 'patrimonio.id', patrimonioId);
  }

  /**
   * O saldo de cada produto no almoxarifado — o passo 3 do fluxo "Produtos do
   * técnico": uma consulta só, filtrada pelo almoxarifado, e não o estoque da
   * casa inteira.
   */
  async saldosNoAlmox(almoxId: number): Promise<Map<number, number>> {
    const linhas = await this.ixc.listAll<Record<string, unknown>>(
      'estoque_produtos_almox_filial',
      {
        qtype: 'estoque_produtos_almox_filial.id_almox',
        query: String(almoxId),
        oper: '=',
        sortname: 'estoque_produtos_almox_filial.id',
        sortorder: 'asc',
      },
      { pageSize: 500, maxPages: 6 },
    );
    const saldos = new Map<number, number>();
    for (const l of linhas) {
      if (numeroDoIxc(l.id_almox) !== almoxId) continue;
      const produtoId = numeroDoIxc(l.id_produto);
      if (produtoId <= 0) continue;
      saldos.set(produtoId, (saldos.get(produtoId) ?? 0) + numeroDoIxc(l.saldo));
    }
    return saldos;
  }

  /** O cadastro de um produto, pronto para entrar numa escrita da OS. */
  async produtoParaOs(produtoId: number): Promise<ProdutoParaOs> {
    const [[unidades], cadastros] = await Promise.all([
      this.produtos.paraMovimentar(),
      this.produtos.cadastrosPorId([produtoId]),
    ]);
    return produtoParaOs(cadastros.get(produtoId), unidades);
  }
}

function motivo(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
