import { Injectable, Logger } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import {
  montarComodatos,
  resumirComodatos,
  type ClienteIxc,
  type ContratoIxc,
  type ItemEmComodato,
  type LinhaDeComodatoIxc,
} from './comodato.mapper';
import { numeroDoIxc } from './estoque.mapper';
import { EstoqueService } from './estoque.service';

/**
 * Quanto a leitura vale. Comodato muda pouco ao longo do dia (a instalação é
 * que o cria), e a leitura junta três tabelas do IXC, duas delas grandes —
 * contrato e cliente. Dez minutos; o botão "Atualizar" refaz na hora.
 */
const VALIDADE_MS = 10 * 60_000;

/** Até quantos contratos se pedem um a um antes de valer ler a tabela inteira. */
const UM_A_UM_ATE = 40;

export interface ComodatoNaTela {
  itens: ItemEmComodato[];
  porProduto: ReturnType<typeof resumirComodatos>;
  lidoEm: string;
}

/**
 * O que está em comodato — emprestado a cliente — e onde, lido do IXC.
 *
 * Só leitura: o comodato nasce e é baixado na OS e no contrato, lá no IXC, e é
 * lá que ele continua sendo mexido.
 */
@Injectable()
export class ComodatoService {
  private readonly logger = new Logger(ComodatoService.name);
  private guardado: { em: number; dados: ComodatoNaTela } | null = null;

  constructor(
    private readonly ixc: IxcClient,
    private readonly estoque: EstoqueService,
  ) {}

  async listar(recarregar = false): Promise<ComodatoNaTela> {
    if (!recarregar && this.guardado && Date.now() - this.guardado.em < VALIDADE_MS) {
      return this.guardado.dados;
    }

    // "Comodato - Produto (listar)", com o filtro do exemplo da documentação.
    const linhas = await this.ixc.listAll<LinhaDeComodatoIxc>(
      'cliente_contrato_comodato',
      {
        qtype: 'movimento_produtos.id',
        query: '0',
        oper: '>',
        sortname: 'movimento_produtos.id',
        sortorder: 'asc',
        gridParam: [{ TB: 'movimento_produtos.status_comodato', OP: '=', P: 'E' }],
      },
      { pageSize: 500 },
    );

    const idsContrato = [...new Set(linhas.map((l) => numeroDoIxc(l.id_contrato)))].filter(
      (id) => id > 0,
    );
    const contratos = await this.porId<ContratoIxc>('cliente_contrato', idsContrato);
    const idsCliente = [
      ...new Set([...contratos.values()].map((c) => numeroDoIxc(c.id_cliente))),
    ].filter((id) => id > 0);
    const [clientes, produtos, almoxarifados] = await Promise.all([
      this.porId<ClienteIxc>('cliente', idsCliente),
      this.nomesDeProdutos(),
      this.nomesDeAlmoxarifados(),
    ]);

    const itens = montarComodatos(linhas, contratos, clientes, produtos, almoxarifados);
    const dados: ComodatoNaTela = {
      itens,
      porProduto: resumirComodatos(itens),
      lidoEm: new Date().toISOString(),
    };
    this.logger.log(
      `Comodato lido do IXC: ${itens.length} peças em ${idsContrato.length} contratos.`,
    );
    this.guardado = { em: Date.now(), dados };
    return dados;
  }

  /**
   * Os registros de uma tabela pelos ids. Poucos: um a um, para não trazer a
   * base inteira de clientes para achar dez nomes. Muitos: a tabela inteira de
   * uma vez, que aí custa menos que centenas de consultas.
   */
  private async porId<T extends { id?: string }>(
    tabela: string,
    ids: number[],
  ): Promise<Map<number, T>> {
    const mapa = new Map<number, T>();
    if (ids.length === 0) return mapa;

    if (ids.length <= UM_A_UM_ATE) {
      const achados = await Promise.all(
        ids.map((id) => this.ixc.getById<T>(tabela, `${tabela}.id`, id).catch(() => null)),
      );
      for (const r of achados) if (r) mapa.set(numeroDoIxc(r.id), r);
      return mapa;
    }

    const todos = await this.ixc.listAll<T>(
      tabela,
      { qtype: `${tabela}.id`, query: '0', oper: '>', sortname: `${tabela}.id`, sortorder: 'asc' },
      { pageSize: 500 },
    );
    const procurados = new Set(ids);
    for (const r of todos) {
      const id = numeroDoIxc(r.id);
      if (procurados.has(id)) mapa.set(id, r);
    }
    return mapa;
  }

  private async nomesDeProdutos(): Promise<Map<number, string>> {
    const linhas = await this.ixc.listAll<{ id?: string; descricao?: string }>(
      'produtos',
      { qtype: 'produtos.id', query: '0', oper: '>', sortname: 'produtos.id', sortorder: 'asc' },
      { pageSize: 500 },
    );
    return new Map(
      linhas
        .map((p) => [numeroDoIxc(p.id), String(p.descricao ?? '').trim()] as const)
        .filter(([id, nome]) => id > 0 && nome !== ''),
    );
  }

  /**
   * id → nome. O `almox` só devolve os almoxarifados ligados ao usuário do
   * sistema — o da van de um técnico fica de fora —, então os nomes que
   * faltam vêm do saldo, onde todo almoxarifado com produto aparece.
   */
  private async nomesDeAlmoxarifados(): Promise<Map<number, string>> {
    const [linhas, doSaldo] = await Promise.all([
      this.ixc.listAll<{ id?: string; descricao?: string }>(
        'almox',
        { qtype: 'almox.id', query: '0', oper: '>', sortname: 'almox.id', sortorder: 'asc' },
        { pageSize: 200, maxPages: 5 },
      ),
      this.estoque
        .almoxarifadosConhecidos()
        .catch(() => [] as Array<{ id: number; nome: string }>),
    ]);
    const nomes = new Map<number, string>(doSaldo.map((a) => [a.id, a.nome]));
    for (const a of linhas) {
      const id = numeroDoIxc(a.id);
      const nome = String(a.descricao ?? '').trim();
      if (id > 0 && nome !== '') nomes.set(id, nome);
    }
    return nomes;
  }
}
