import { BadRequestException, Injectable } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import type { IxcListResponse, IxcOper } from '../ixc/ixc.types';

/**
 * As tabelas do IXC que os relatórios da contabilidade leem.
 *
 * A lista é fechada de propósito: esta rota existe para conferir, na base de
 * verdade, se a coluna que a documentação promete é a que esta instalação
 * devolve — a lição de `docs-da-api-do-ixc` é que a coleção do Postman acerta
 * quase sempre, e o "quase" é onde o número sai errado calado. Aberta a
 * qualquer nome, ela viraria uma janela para o IXC inteiro.
 */
export const TABELAS_DA_CONTABILIDADE = new Set([
  'contas',
  'fn_areceber',
  'fn_areceber_baixas',
  'fn_movim_finan',
  'vd_saida',
  'fn_apagar',
  'fn_apagar_arquivos',
  'movimento_produtos',
  'produtos',
  'estoque_produtos_almox_filial',
  'planejamento_analitico',
  'fn_carteira_cobranca',
  'almox',
  'filial',
  'fl_adto_salario',
  'unidades',
]);

/** Colunas que guardam segredo (token de integração, senha) não saem daqui. */
const SEGREDO = /secret|token|senha|password|chave_api|api_key|client_id|certificado/i;

const OPERADORES: ReadonlySet<string> = new Set([
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  'L',
  'NL',
]);

export interface PedidoDeDiagnostico {
  qtype?: string;
  query?: string;
  oper?: string;
  page?: string;
  rp?: string;
  sortname?: string;
  sortorder?: string;
  /** O `grid_param` em JSON, como a documentação o escreve. */
  grid?: string;
}

/**
 * Uma página crua de uma tabela do IXC, só leitura.
 *
 * É o que permite conferir um relatório contra a base antes de confiar nele:
 * ler o título que a soma diz estar em aberto, ver em que coluna o acréscimo do
 * recebimento mora nesta instalação, contar quantas linhas um mês tem. Tudo
 * pelo mesmo `listar` que os relatórios usam — o que esta rota mostra é o que
 * eles enxergam.
 */
@Injectable()
export class DiagnosticoService {
  constructor(private readonly ixc: IxcClient) {}

  async ler(
    tabela: string,
    pedido: PedidoDeDiagnostico,
  ): Promise<IxcListResponse & { pedido: Record<string, unknown> }> {
    if (!TABELAS_DA_CONTABILIDADE.has(tabela)) {
      throw new BadRequestException(
        `A tabela "${tabela}" não é uma das que a contabilidade lê.`,
      );
    }

    const oper = pedido.oper ?? '>=';
    if (!OPERADORES.has(oper)) {
      throw new BadRequestException(`Operador "${oper}" não existe no IXC.`);
    }

    let gridParam: unknown;
    if (pedido.grid) {
      try {
        gridParam = JSON.parse(pedido.grid);
      } catch {
        throw new BadRequestException('O filtro (grid) não é um JSON válido.');
      }
    }

    const parametros = {
      qtype: pedido.qtype || `${tabela}.id`,
      query: pedido.query ?? '0',
      oper: oper as IxcOper,
      page: Math.max(1, Number(pedido.page) || 1),
      // Mil por página é o teto: acima disso o IXC demora mais que o proxy
      // espera, e quem confere quer amostra, não a tabela.
      rp: Math.min(1000, Math.max(1, Number(pedido.rp) || 20)),
      sortname: pedido.sortname || `${tabela}.id`,
      sortorder: pedido.sortorder === 'asc' ? ('asc' as const) : ('desc' as const),
      gridParam,
    };

    const res = await this.ixc.list<Record<string, unknown>>(tabela, parametros);
    const registros = res.registros.map((r) =>
      Object.fromEntries(Object.entries(r).filter(([coluna]) => !SEGREDO.test(coluna))),
    );
    return { ...res, registros, pedido: { tabela, ...parametros } };
  }
}
