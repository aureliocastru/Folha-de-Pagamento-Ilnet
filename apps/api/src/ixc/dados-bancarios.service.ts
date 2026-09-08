import { Injectable, Logger } from '@nestjs/common';
import type { TipoChavePix } from './ixc.financeiro';
import { IxcClient } from './ixc.client';
import {
  aprenderPreferenciaPix,
  consolidarDadosBancarios,
  destinoDaChavePix,
  detectarCampoFornecedor,
  TABELAS_DADOS_BANCARIOS,
  type DadosBancariosFornecedor,
  type PreferenciaPix,
} from './ixc.fornecedor';

/**
 * Lê a aba "Dados bancários" do fornecedor no IXC — banco, agência, conta e a
 * chave PIX (que o IXC guarda em colunas separadas: PIX CPF/CNPJ, celular e
 * e-mail). É uma tabela à parte, ligada ao fornecedor por `id_fornecedor`.
 *
 * O nome dessa tabela varia entre versões do IXC e não está na documentação
 * pública, então é descoberto na primeira consulta testando os candidatos —
 * e pode ser fixado na configuração financeira se nenhum servir.
 */
@Injectable()
export class DadosBancariosService {
  private readonly logger = new Logger(DadosBancariosService.name);

  /** undefined = ainda não procurou; null = procurou e não achou. */
  private tabela: string | null | undefined;
  private campoFornecedor: string | null | undefined;
  /** Como esta base marca "preferencial" e "por Pix". Aprendido uma vez. */
  private preferencia: PreferenciaPix | undefined;

  constructor(private readonly ixc: IxcClient) {}

  /** Esquece a tabela descoberta (usado quando a configuração muda). */
  reset(): void {
    this.tabela = undefined;
    this.campoFornecedor = undefined;
    this.preferencia = undefined;
  }

  /** Nome da tabela em uso, se já descoberta. */
  get tabelaEmUso(): string | null | undefined {
    return this.tabela;
  }

  /**
   * Dados bancários de um fornecedor. Retorna tudo null quando a tabela não
   * existe ou o fornecedor não tem linha cadastrada — nunca lança, para não
   * derrubar a sincronização inteira por causa de um registro.
   */
  async doFornecedor(
    idFornecedor: number,
    tabelaConfigurada?: string | null,
  ): Promise<DadosBancariosFornecedor> {
    const vazio: DadosBancariosFornecedor = {
      banco: null,
      agencia: null,
      conta: null,
      chavePix: null,
      tipoChavePix: null,
    };

    const tabela = await this.resolverTabela(tabelaConfigurada);
    if (!tabela) return vazio;

    const campo = this.campoFornecedor ?? 'id_fornecedor';
    try {
      const res = await this.ixc.list<Record<string, unknown>>(tabela, {
        qtype: `${tabela}.${campo}`,
        query: String(idFornecedor),
        oper: '=',
        rp: 50,
        sortname: `${tabela}.id`,
        sortorder: 'asc',
      });
      if (res.registros.length === 0) return vazio;
      return consolidarDadosBancarios(res.registros);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Falha ao ler dados bancários do fornecedor #${idFornecedor}: ${message}`,
      );
      return vazio;
    }
  }

  /**
   * Grava a chave PIX na aba "Dados bancários" do fornecedor, para o próximo
   * pagamento já sair sem ninguém digitar de novo — e para a tela de contas a
   * pagar do IXC preencher sozinha quando alguém lançar por lá.
   *
   * Escrever em tabela descoberta por tentativa pede cuidado, então isto só
   * grava com um registro existente na mão para copiar os nomes das colunas, e
   * só quando existe a coluna do tipo daquela chave. Sem isso, desiste e diz
   * por quê: a chave continua valendo aqui, que é de onde a conta a pagar a
   * tira — não gravar lá atrasa uma digitação; gravar errado cria uma chave
   * falsa no cadastro, e o erro só apareceria com o pagamento recusado.
   */
  async gravarPix(
    idFornecedor: number,
    chave: string,
    tipo: TipoChavePix | null,
    tabelaConfigurada?: string | null,
  ): Promise<{ gravado: boolean; motivo?: string }> {
    const tabela = await this.resolverTabela(tabelaConfigurada);
    if (!tabela) {
      return {
        gravado: false,
        motivo:
          'não achei a tabela de dados bancários do fornecedor no seu IXC (informe o nome em Configurações)',
      };
    }
    const campo = this.campoFornecedor ?? 'id_fornecedor';

    try {
      const doFornecedor = await this.ixc.list<Record<string, unknown>>(tabela, {
        qtype: `${tabela}.${campo}`,
        query: String(idFornecedor),
        oper: '=',
        rp: 50,
        sortname: `${tabela}.id`,
        sortorder: 'asc',
      });

      // Sem linha desta pessoa, qualquer outra serve de molde: o que se copia
      // dela são os nomes das colunas, nunca os valores.
      const modelo = doFornecedor.registros[0] ?? (await this.umaLinha(tabela));
      if (!modelo) {
        return {
          gravado: false,
          motivo:
            `a tabela "${tabela}" está vazia, então não tenho de onde copiar o ` +
            'formato. Cadastre a chave à mão numa pessoa no IXC e a partir daí eu consigo',
        };
      }

      const destino = destinoDaChavePix(modelo, tipo);
      if (!destino) {
        return {
          gravado: false,
          motivo: `a tabela "${tabela}" não tem coluna para chave do tipo ${tipo ?? 'informado'}`,
        };
      }

      /*
       * A conta não nasce só com a chave: ela nasce marcada.
       *
       * Na aba "Dados bancários" do IXC são três coisas, e as três decidem se o
       * dinheiro sai — "Pagar preferencialmente nesta conta", "Pagar
       * preferencialmente por: Pix" (obrigatório lá) e o "Tipo de Pix
       * preferencial". Gravar só a chave deixava as outras duas em branco, e
       * uma conta bancária que não é a preferencial é uma chave que o
       * pagamento não usa.
       *
       * Os códigos são aprendidos das linhas que já estão assim nesta base —
       * ver `aprenderPreferenciaPix`.
       */
      const preferencia = await this.resolverPreferencia(tabela);
      const codigoDoTipo = tipo
        ? (preferencia.codigosTipo[tipo] ?? tipo)
        : null;

      const corpo: Record<string, unknown> = {
        [campo]: String(idFornecedor),
        [destino.campoChave]: chave,
        ...preferencia.campos,
        ...(destino.campoTipo && codigoDoTipo
          ? { [destino.campoTipo]: codigoDoTipo }
          : {}),
      };

      const existente = doFornecedor.registros[0];
      if (existente?.id) {
        await this.ixc.update(tabela, String(existente.id), corpo);
        this.logger.log(
          `Chave PIX gravada no fornecedor #${idFornecedor} (${tabela} #${String(existente.id)}, coluna ${destino.campoChave})`,
        );
      } else {
        const { id } = await this.ixc.create(tabela, corpo);
        this.logger.log(
          `Dados bancários criados para o fornecedor #${idFornecedor} (${tabela} #${id}, coluna ${destino.campoChave})`,
        );
      }
      return { gravado: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Não gravei a chave PIX do fornecedor #${idFornecedor}: ${message}`,
      );
      return { gravado: false, motivo: message };
    }
  }

  /**
   * Como esta base marca a conta preferencial e a forma "Pix", aprendido uma
   * vez por processo de uma amostra do próprio grid.
   *
   * Não achando nada de onde aprender, devolve vazio: a chave é gravada do
   * mesmo jeito, e o que fica em branco é o que já ficava antes disto existir.
   */
  private async resolverPreferencia(tabela: string): Promise<PreferenciaPix> {
    if (this.preferencia !== undefined) return this.preferencia;

    try {
      const res = await this.ixc.list<Record<string, unknown>>(tabela, {
        qtype: `${tabela}.id`,
        query: '0',
        oper: '>',
        rp: 200,
        sortname: `${tabela}.id`,
        sortorder: 'desc',
      });
      this.preferencia = aprenderPreferenciaPix(res.registros);
      this.logger.log(
        `Preferência de pagamento em "${tabela}": ` +
          `${JSON.stringify(this.preferencia.campos)} — tipos ` +
          JSON.stringify(this.preferencia.codigosTipo),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Não deu para aprender a preferência de pagamento em "${tabela}": ${message}`,
      );
      this.preferencia = { campos: {}, codigosTipo: {} };
    }
    return this.preferencia;
  }

  /** Uma linha qualquer da tabela, só para saber os nomes das colunas. */
  private async umaLinha(
    tabela: string,
  ): Promise<Record<string, unknown> | null> {
    const res = await this.ixc.list<Record<string, unknown>>(tabela, {
      qtype: `${tabela}.id`,
      query: '0',
      oper: '>',
      rp: 1,
      sortname: `${tabela}.id`,
      sortorder: 'desc',
    });
    return res.registros[0] ?? null;
  }

  /**
   * Descobre (uma vez por processo) a tabela do grid e o campo que aponta para
   * o fornecedor. Usa a tabela configurada quando informada.
   */
  private async resolverTabela(
    tabelaConfigurada?: string | null,
  ): Promise<string | null> {
    const configurada = (tabelaConfigurada ?? '').trim();
    if (configurada && configurada !== this.tabela) {
      this.tabela = undefined; // configuração mudou: procura de novo
    }
    if (this.tabela !== undefined) return this.tabela;

    const candidatos = configurada
      ? [configurada]
      : [...TABELAS_DADOS_BANCARIOS];

    for (const tabela of candidatos) {
      try {
        const res = await this.ixc.list<Record<string, unknown>>(tabela, {
          qtype: `${tabela}.id`,
          query: '0',
          oper: '>',
          rp: 1,
        });
        this.tabela = tabela;
        this.campoFornecedor = res.registros[0]
          ? detectarCampoFornecedor(res.registros[0])
          : 'id_fornecedor';
        this.logger.log(
          `Dados bancários do fornecedor na tabela "${tabela}" ` +
            `(vínculo: ${this.campoFornecedor ?? 'id_fornecedor'})`,
        );
        return this.tabela;
      } catch {
        // Tabela inexistente nesta base: tenta a próxima.
      }
    }

    this.tabela = null;
    this.logger.warn(
      'Tabela de dados bancários do fornecedor não encontrada. Tentados: ' +
        `${candidatos.join(', ')}. Informe o nome em Configurações se souber.`,
    );
    return null;
  }
}
