import { Logger } from '@nestjs/common';
import { lookup as lookupDoSistema, promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * Descobre o endereço do IXC sem depender de um DNS só.
 *
 * Em 11/11/2026 toda tela que lê o IXC parou com `getaddrinfo EAI_AGAIN
 * ixc.ilnet.com.br`. O IXC estava de pé; quem falhava era o DNS que o servidor
 * usa, que não conseguia falar com os servidores do domínio — enquanto o DNS
 * do Google respondia o mesmo nome na hora. A casa ficou sem ver conta
 * nenhuma por causa de uma pergunta que qualquer outro DNS sabia responder.
 *
 * A ordem:
 *  1. o endereço achado há pouco, enquanto vale — e de quebra o nome deixa de
 *     ser perguntado a cada conexão;
 *  2. o DNS do sistema, como sempre foi;
 *  3. falhando ele, os DNS públicos;
 *  4. falhando todos, o último endereço que funcionou, por velho que seja: o
 *     IXC não muda de endereço de uma hora para outra, e um endereço de ontem
 *     vale mais que tela nenhuma.
 *
 * Só o endereço vem daqui. O certificado continua sendo conferido contra o
 * nome: um endereço errado não passa por IXC.
 */

/** Por quanto tempo um endereço achado é usado sem perguntar de novo. */
const VALE_MS = 5 * 60_000;
/** Depois de uma falha do DNS do sistema, quanto esperar para tentar nele outra vez. */
const DESCANSO_DO_SISTEMA_MS = 60_000;
/** Teto de cada pergunta aos DNS públicos. */
const ESPERA_PUBLICO_MS = 3_000;
const DNS_PUBLICOS = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];

export interface Endereco {
  address: string;
  family: number;
}

export interface Fontes {
  sistema: (nome: string) => Promise<Endereco[]>;
  publico: (nome: string) => Promise<Endereco[]>;
  agora: () => number;
}

const fontesDeVerdade: Fontes = {
  sistema: (nome) =>
    new Promise((resolve, reject) => {
      lookupDoSistema(nome, { all: true }, (erro, lista) =>
        erro ? reject(erro) : resolve(lista),
      );
    }),
  publico: async (nome) => {
    const resolvedor = new dns.Resolver({ timeout: ESPERA_PUBLICO_MS, tries: 1 });
    resolvedor.setServers(DNS_PUBLICOS);
    const lista = await resolvedor.resolve4(nome);
    return lista.map((address) => ({ address, family: 4 }));
  },
  agora: () => Date.now(),
};

export class EnderecoDoIxc {
  private readonly logger = new Logger('EnderecoDoIxc');
  private guardado = new Map<string, { lista: Endereco[]; em: number }>();
  private sistemaFalhouEm = new Map<string, number>();
  private pedidos = new Map<string, Promise<Endereco[]>>();

  constructor(private readonly fontes: Fontes = fontesDeVerdade) {}

  async achar(nome: string): Promise<Endereco[]> {
    const familia = isIP(nome);
    if (familia) return [{ address: nome, family: familia }];

    const tem = this.guardado.get(nome);
    if (tem && this.fontes.agora() - tem.em < VALE_MS) return tem.lista;

    // Várias conexões abrindo juntas fazem uma pergunta só.
    let pedido = this.pedidos.get(nome);
    if (!pedido) {
      pedido = this.perguntar(nome).finally(() => this.pedidos.delete(nome));
      this.pedidos.set(nome, pedido);
    }
    return pedido;
  }

  private async perguntar(nome: string): Promise<Endereco[]> {
    const agora = this.fontes.agora();
    const falhouEm = this.sistemaFalhouEm.get(nome);
    const sistemaDescansando =
      falhouEm !== undefined && agora - falhouEm < DESCANSO_DO_SISTEMA_MS;

    let erroDoSistema: unknown;
    if (!sistemaDescansando) {
      try {
        const lista = await this.fontes.sistema(nome);
        if (lista.length > 0) {
          if (falhouEm !== undefined) {
            this.logger.log(`O DNS do servidor voltou a responder ${nome}.`);
          }
          this.sistemaFalhouEm.delete(nome);
          return this.guardar(nome, lista);
        }
      } catch (erro) {
        erroDoSistema = erro;
      }
      this.sistemaFalhouEm.set(nome, agora);
      this.logger.warn(
        `O DNS do servidor não respondeu ${nome} (${motivo(erroDoSistema)}); ` +
          'perguntando a um DNS público.',
      );
    }

    try {
      const lista = await this.fontes.publico(nome);
      if (lista.length > 0) return this.guardar(nome, lista);
    } catch (erro) {
      erroDoSistema ??= erro;
    }

    const velho = this.guardado.get(nome);
    if (velho) {
      this.logger.warn(
        `Nenhum DNS respondeu ${nome}; usando o último endereço que funcionou ` +
          `(${velho.lista[0].address}).`,
      );
      return velho.lista;
    }
    throw erroDoSistema ?? new Error(`Nenhum DNS respondeu ${nome}`);
  }

  private guardar(nome: string, lista: Endereco[]): Endereco[] {
    this.guardado.set(nome, { lista, em: this.fontes.agora() });
    return lista;
  }

  /**
   * No formato que o `http.Agent` do Node espera em `lookup`. Ele pede ora um
   * endereço, ora a lista (`all`), conforme a versão — responde aos dois.
   */
  readonly lookup = (
    nome: string,
    opcoes: { all?: boolean; family?: number | string } | number | undefined,
    devolver: (
      erro: NodeJS.ErrnoException | null,
      endereco: string | Endereco[],
      familia?: number,
    ) => void,
  ): void => {
    const todos = typeof opcoes === 'object' && opcoes?.all === true;
    this.achar(nome).then(
      (lista) => {
        if (todos) devolver(null, lista);
        else devolver(null, lista[0].address, lista[0].family);
      },
      // Com erro o Node não lê o endereço; a string vazia só cumpre a assinatura.
      (erro: NodeJS.ErrnoException) => devolver(erro, ''),
    );
  };
}

function motivo(erro: unknown): string {
  if (erro && typeof erro === 'object' && 'code' in erro) return String(erro.code);
  return erro instanceof Error ? erro.message : 'sem endereço';
}
