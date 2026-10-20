import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { Agent } from 'node:https';
import type { AppConfig } from '../config/configuration';

export type ConfigModobank = AppConfig['modobank'];

/** O status de um pagamento, como o banco escreve. */
export type StatusDoBanco =
  | 'CANCELED'
  | 'PROCESSING'
  | 'LIQUIDATED'
  | 'ON_QUEUE'
  | 'WAITING_APPROVAL'
  | 'WAITING_CONFIRMATION'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

/** Um boleto consultado no banco, antes de pagar. */
export interface BoletoNoBanco {
  linhaDigitavel: string;
  favorecido: string | null;
  documentoDoFavorecido: string | null;
  vencimento: Date | null;
  /** O que o banco cobraria hoje: o valor com juros, multa e desconto. */
  valor: number;
  valorOriginal: number | null;
  /** Boleto de valor aberto (fatura de cartão): o banco não paga pela API. */
  valorLivre: boolean;
}

/** O dono de uma chave Pix, segundo o diretório do Banco Central. */
export interface DonoDaChave {
  nome: string | null;
  documento: string | null;
  banco: string | null;
  /**
   * O id da consulta. Vai junto no pagamento: é o que liga os dois e faz a
   * consulta não contar duas vezes no limite de consultas de chave do banco.
   */
  endToEndId: string | null;
}

/** A resposta de um pagamento mandado: por onde acompanhá-lo. */
export interface PagamentoAceito {
  idNoBanco: string | null;
  status: StatusDoBanco | null;
}

/** Onde um pagamento está agora. */
export interface SituacaoDoPagamento {
  status: StatusDoBanco | null;
  /** O código do motivo, quando o Pix não saiu (AM04 = sem saldo…). */
  codigoDoErro: string | null;
  /** O id que o banco deu: só a consulta pela chave o traz. */
  idNoBanco: string | null;
  liquidadoEm: Date | null;
}

/**
 * Recusa do banco, com o que ele disse. O status HTTP do banco
 * (`statusDoBanco`) decide o que fazer.
 *
 * É um erro HTTP do Nest: a que ninguém pega no caminho chega à tela com a
 * frase do banco — recusa dele vira 400, falha dele 502. Antes era um `Error`
 * cru, e a prévia de um DARF recusado aparecia só como "Internal server error".
 */
export class RecusaDoBanco extends HttpException {
  constructor(
    message: string,
    readonly statusDoBanco: number,
  ) {
    super(message, statusDoBanco >= 500 ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_REQUEST);
  }
}

/**
 * A API do ModoBank — a plataforma ONZ, na instância do banco.
 *
 * Toda chamada leva o certificado da credencial (mTLS) e um token OAuth2 que
 * dura alguns minutos. O certificado é o que o banco confere primeiro: com ele
 * errado a resposta é `onz-0001`, antes de qualquer senha.
 *
 * Só sabe falar com o banco. O que pagar, e o que fazer com a resposta, é do
 * `PagamentosNoBancoService`.
 */
@Injectable()
export class ModobankClient {
  private readonly logger = new Logger(ModobankClient.name);
  private http: AxiosInstance | null = null;
  private token: { valor: string; ate: number } | null = null;

  constructor(private readonly cfg: ConfigModobank) {}

  /** As quatro peças da credencial estão no ambiente. */
  get configurado(): boolean {
    return !!(this.cfg.clientId && this.cfg.clientSecret && this.cfg.certificado && this.cfg.url);
  }

  /**
   * Abre a conversa com o banco — certificado, credencial e IP — sem pedir
   * nada além do token. É a prova de que a credencial está de pé.
   */
  async conectar(): Promise<void> {
    await this.tokenValido();
  }

  /**
   * Onde fica o token neste endereço: pede-o em cada caminho comum e diz o
   * que cada um respondeu. 404 é caminho que não existe; qualquer outra
   * resposta (200, 400, 401) é o caminho certo. Serve para achar o do
   * recebimento, cuja documentação o banco não mandou. Só os status saem
   * daqui — nunca o corpo, que pode trazer o token.
   */
  async sondarToken(): Promise<Array<{ caminho: string; status: number | string }>> {
    const origem = new URL(this.cfg.url).origin;
    const caminhos = [
      '/oauth/token',
      '/api/v2/oauth/token',
      '/api/v1/oauth/token',
      '/v2/oauth/token',
      '/v1/oauth/token',
      '/api/oauth/token',
      '/oauth2/token',
      '/token',
      '/auth/token',
      '/api/v2/token',
      '/api/token',
    ];
    const corpo = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
    }).toString();
    const achados: Array<{ caminho: string; status: number | string }> = [];
    for (const caminho of caminhos) {
      try {
        const r = await this.cliente().post(`${origem}${caminho}`, corpo, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        achados.push({ caminho, status: r.status });
      } catch (err) {
        achados.push({ caminho, status: err instanceof Error ? err.message.slice(0, 80) : 'erro' });
      }
    }
    return achados;
  }

  get fluxo(): ConfigModobank['fluxo'] {
    return this.cfg.fluxo;
  }

  /** O saldo disponível na conta. */
  async saldo(): Promise<number | null> {
    const r = await this.pedir<{ data?: Array<{ balanceAmount?: { available?: number } }> }>(
      'get',
      '/accounts/balances',
    );
    const disponivel = r.data?.[0]?.balanceAmount?.available;
    return typeof disponivel === 'number' ? disponivel : null;
  }

  /** Lê o boleto no banco sem pagar: quem recebe e quanto ele cobra hoje. */
  async consultarBoleto(codigo: string): Promise<BoletoNoBanco> {
    const r = await this.pedir<Record<string, unknown>>('post', '/billets/info', {
      billetCode: codigo.replace(/\D/g, ''),
    });
    const numero = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? NaN));
    const total = numero(r.totalUpdated);
    const original = numero(r.originalValue);
    return {
      linhaDigitavel: String(r.digitableCode ?? '').replace(/\D/g, '') || codigo.replace(/\D/g, ''),
      favorecido: texto(r.recipient),
      documentoDoFavorecido: texto(r.documentRecipient),
      vencimento: data(r.payDueDate ?? r.dueDateRegister),
      valor: Number.isFinite(total) ? total : Number.isFinite(original) ? original : 0,
      valorOriginal: Number.isFinite(original) ? original : null,
      valorLivre: r.allowChangeValue === true,
    };
  }

  async pagarBoleto(p: {
    linhaDigitavel: string;
    valor: number;
    descricao: string;
    chave: string;
  }): Promise<PagamentoAceito> {
    const r = await this.pedir<Record<string, unknown>>(
      'post',
      '/billets/payments',
      {
        digitableCode: p.linhaDigitavel,
        description: p.descricao,
        paymentFlow: this.cfg.fluxo,
        payment: { currency: 'BRL', amount: centavos(p.valor) },
      },
      { 'x-idempotency-key': p.chave },
    );
    return { idNoBanco: texto(r.id), status: status(r.status) };
  }

  /**
   * Quem é o dono da chave — o nome que aparece antes de confirmar. Null = a
   * chave não existe no Pix.
   */
  async donoDaChave(chave: string): Promise<DonoDaChave | null> {
    let r: Record<string, unknown>;
    try {
      r = await this.pedir<Record<string, unknown>>(
        'get',
        `/pix/keys/${encodeURIComponent(chave)}`,
      );
    } catch (err) {
      if (err instanceof RecusaDoBanco && err.statusDoBanco === 404) return null;
      throw err;
    }
    const d = (r.data ?? r) as Record<string, unknown>;
    return {
      nome: texto(d.name ?? d.tradeName),
      documento: texto(d.document),
      banco: texto(d.ispb_reduced_name),
      endToEndId: texto(d.endToEndId),
    };
  }

  /** Lê um Pix copia e cola: quem recebe e quanto ele pede. */
  async lerCopiaECola(
    codigo: string,
    chave: string,
  ): Promise<{ favorecido: string | null; valor: number | null }> {
    const r = await this.pedir<Record<string, unknown>>(
      'post',
      '/pix/payments/qrc/info',
      { qrCode: codigo.trim() },
      { 'x-idempotency-key': chave },
    );
    const d = (r.data ?? r) as Record<string, unknown>;
    const valor = Number(d.transactionAmount ?? NaN);
    return {
      favorecido: texto(d.merchantName),
      valor: Number.isFinite(valor) && valor > 0 ? valor : null,
    };
  }

  async pagarPix(p: {
    /** A chave Pix, ou o código copia e cola. */
    destino: string;
    copiaECola: boolean;
    valor: number;
    descricao: string;
    chave: string;
    /** O da consulta da chave feita antes (`donoDaChave`). */
    endToEndIdDaConsulta?: string | null;
  }): Promise<PagamentoAceito> {
    const r = await this.pedir<Record<string, unknown>>(
      'post',
      p.copiaECola ? '/pix/payments/qrc' : '/pix/payments/dict',
      {
        ...(p.copiaECola
          ? { qrCode: p.destino }
          : {
              pixKey: p.destino,
              ...(p.endToEndIdDaConsulta ? { endToEndId: p.endToEndIdDaConsulta } : {}),
            }),
        description: p.descricao,
        paymentFlow: this.cfg.fluxo,
        payment: { currency: 'BRL', amount: centavos(p.valor) },
      },
      { 'x-idempotency-key': p.chave },
    );
    // O Pix responde com o endToEndId: é por ele que se acompanha.
    return { idNoBanco: texto(r.endToEndId ?? r.id), status: status(r.status) };
  }

  async situacaoDoBoleto(id: string): Promise<SituacaoDoPagamento> {
    const r = await this.pedir<{ data?: Record<string, unknown> }>(
      'get',
      `/billets/${encodeURIComponent(id)}`,
    );
    const d = r.data ?? {};
    const info = (d.billetInfo ?? {}) as Record<string, unknown>;
    return {
      status: status(d.status),
      codigoDoErro: null,
      idNoBanco: texto(d.id),
      liquidadoEm: data(info.settleDate),
    };
  }

  async situacaoDoPix(endToEndId: string): Promise<SituacaoDoPagamento> {
    const r = await this.pedir<{ data?: Record<string, unknown> }>(
      'get',
      `/pix/payments/${encodeURIComponent(endToEndId)}`,
    );
    return lerSituacaoDoPix(r.data ?? {});
  }

  /**
   * O Pix pela chave de idempotência — para quando a resposta do pagamento se
   * perdeu e não se sabe se ele chegou ao banco. Null = não chegou.
   */
  async pixPelaChave(chave: string): Promise<SituacaoDoPagamento | null> {
    try {
      const r = await this.pedir<{ data?: Record<string, unknown> }>(
        'get',
        `/pix/payments/idempotencyKey/${encodeURIComponent(chave)}`,
      );
      return lerSituacaoDoPix(r.data ?? {});
    } catch (err) {
      if (err instanceof RecusaDoBanco && err.statusDoBanco === 404) return null;
      throw err;
    }
  }

  /** O boleto pago pela chave de idempotência, procurado na lista do banco. */
  async boletoPelaChave(chave: string): Promise<SituacaoDoPagamento | null> {
    // A lista vem do mais novo para o mais velho, e a chave procurada é de
    // minutos atrás: a primeira página basta.
    const r = await this.pedir<{ data?: Array<Record<string, unknown>> }>('get', '/billets');
    const achado = (r.data ?? []).find((b) => b.idempotencyKey === chave);
    if (!achado) return null;
    return {
      status: status(achado.status),
      codigoDoErro: null,
      idNoBanco: texto(achado.id),
      liquidadoEm: null,
    };
  }

  /** O comprovante em PDF. */
  async comprovante(forma: 'BOLETO' | 'PIX', idNoBanco: string): Promise<Buffer> {
    const caminho =
      forma === 'BOLETO'
        ? `/billets/payments/receipt/${encodeURIComponent(idNoBanco)}`
        : `/pix/payments/receipt/${encodeURIComponent(idNoBanco)}`;
    // Lido como bytes: o banco pode mandar o PDF cru ou um JSON com ele dentro.
    const r = await this.pedir<ArrayBuffer>('get', caminho, undefined, undefined, 'arraybuffer');
    const bruto = Buffer.from(r);
    const pdf = pdfDaResposta(bruto);
    if (!pdf) {
      // Só a forma (chaves e tamanhos), nunca o conteúdo: é o que diz como ler.
      this.logger.warn(`Comprovante do ModoBank num formato desconhecido: ${formaDaResposta(bruto)}`);
      throw new ServiceUnavailableException('O banco não devolveu o comprovante.');
    }
    return pdf;
  }

  /**
   * Uma chamada autenticada. O 401 limpa o token e tenta mais uma vez: ele
   * pode ter vencido entre a leitura do relógio e a chegada ao banco.
   */
  private async pedir<T>(
    metodo: 'get' | 'post',
    caminho: string,
    corpo?: unknown,
    cabecalhos?: Record<string, string>,
    formato: 'json' | 'arraybuffer' = 'json',
  ): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      const token = await this.tokenValido();
      const r = await this.enviar(() =>
        this.cliente().request({
          method: metodo,
          url: caminho,
          data: corpo,
          headers: { Authorization: `Bearer ${token}`, ...cabecalhos },
          responseType: formato,
        }),
      );
      if (r.status === 401 && tentativa === 1) {
        this.token = null;
        continue;
      }
      if (r.status >= 400) {
        // A recusa vem em JSON mesmo quando se pediu bytes.
        if (formato === 'arraybuffer') r.data = jsonOuTexto(Buffer.from(r.data as ArrayBuffer));
        throw new RecusaDoBanco(`ModoBank: ${mensagemDoBanco(r)}`, r.status);
      }
      return r.data as T;
    }
  }

  private async tokenValido(): Promise<string> {
    if (this.token && this.token.ate > Date.now()) return this.token.valor;
    if (!this.configurado) {
      throw new ServiceUnavailableException(
        'A API do ModoBank não está configurada no servidor (MODOBANK_CLIENT_ID, ' +
          'MODOBANK_CLIENT_SECRET e MODOBANK_CERTIFICADO).',
      );
    }
    const r = await this.enviar(() =>
      this.cliente().post(
        '/oauth/token',
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      ),
    );
    if (r.status >= 400) {
      throw new RecusaDoBanco(
        `ModoBank recusou a credencial: ${mensagemDoBanco(r)}`,
        r.status,
      );
    }
    const lido = lerToken(r.data, Date.now());
    if (!lido) {
      throw new ServiceUnavailableException('O ModoBank respondeu sem token.');
    }
    this.token = lido;
    return lido.valor;
  }

  /** Erro de rede ou de certificado vira uma frase que diz qual dos dois foi. */
  private async enviar(chamada: () => Promise<AxiosResponse>): Promise<AxiosResponse> {
    try {
      return await chamada();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao falar com o ModoBank: ${msg}`);
      throw new ServiceUnavailableException(explicarFalhaDeRede(msg));
    }
  }

  private cliente(): AxiosInstance {
    if (this.http) return this.http;
    this.http = axios.create({
      baseURL: this.cfg.url,
      timeout: this.cfg.timeoutMs,
      httpsAgent: new Agent({
        ...certificado(this.cfg.certificado, this.cfg.senhaDoCertificado),
        keepAlive: true,
        /*
         * Só IPv4: a credencial libera um IP, o 170.0.124.7. Se o servidor
         * saísse por IPv6, o banco veria outro endereço e recusaria.
         */
        family: 4,
      }),
      headers: { 'Content-Type': 'application/json' },
      // Todo status volta para cá: quem lê a recusa é `pedir`.
      validateStatus: () => true,
    });
    return this.http;
  }
}

/**
 * O PDF do comprovante, de onde ele vier na resposta.
 *
 * O manual não diz a forma, e a primeira tentativa (`data.pdf`) não era ela.
 * Aceita o PDF cru, ou qualquer texto do JSON que seja um PDF em base64 — com
 * ou sem o "data:application/pdf;base64," na frente —, em qualquer chave e
 * profundidade. Null = não veio PDF nenhum.
 */
export function pdfDaResposta(bruto: Buffer): Buffer | null {
  if (bruto.subarray(0, 5).toString('latin1') === '%PDF-') return bruto;
  const json = jsonOuTexto(bruto);
  const achar = (v: unknown): Buffer | null => {
    if (typeof v === 'string') {
      const base64 = v.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
      // "JVBER" é o "%PDF" em base64.
      return base64.startsWith('JVBER') ? Buffer.from(base64, 'base64') : null;
    }
    if (v && typeof v === 'object') {
      for (const filho of Object.values(v as Record<string, unknown>)) {
        const achado = achar(filho);
        if (achado) return achado;
      }
    }
    return null;
  };
  return achar(json);
}

/**
 * A forma de uma resposta, sem o conteúdo: "{data:{receipt:texto(48210)}}".
 * Vai para o log quando o comprovante não é reconhecido.
 */
export function formaDaResposta(bruto: Buffer): string {
  const json = jsonOuTexto(bruto);
  const forma = (v: unknown, fundo: number): string => {
    if (typeof v === 'string') return `texto(${v.length})`;
    if (Array.isArray(v)) return `[${v.length}${v.length ? ` × ${forma(v[0], fundo + 1)}` : ''}]`;
    if (v && typeof v === 'object') {
      if (fundo > 4) return '{…}';
      return `{${Object.entries(v as Record<string, unknown>)
        .map(([k, x]) => `${k}:${forma(x, fundo + 1)}`)
        .join(',')}}`;
    }
    return v === null ? 'null' : typeof v;
  };
  return typeof json === 'string'
    ? `não é JSON: ${bruto.length} bytes, começa por ${JSON.stringify(bruto.subarray(0, 12).toString('latin1'))}`
    : forma(json, 0);
}

function jsonOuTexto(bruto: Buffer): unknown {
  const texto = bruto.toString('utf8');
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

/**
 * O certificado como o Node o aceita.
 *
 * Na variável vai o .pfx em base64 — é binário, e variável de ambiente só
 * guarda texto. Também serve PEM (certificado e chave no mesmo texto), que é o
 * jeito de contornar um .pfx em formato antigo que o OpenSSL 3 não abre.
 */
export function certificado(
  conteudo: string,
  senha: string,
): { pfx: Buffer; passphrase?: string } | { cert: string; key: string; passphrase?: string } {
  const passphrase = senha || undefined;
  // PEM só serve com a chave junto; sem ela, o cabeçalho é o do certutil.
  if (conteudo.includes('PRIVATE KEY-----')) {
    return { cert: conteudo, key: conteudo, passphrase };
  }
  // O `certutil -encode` do Windows põe cabeçalho e quebra linhas: sai tudo.
  const base64 = conteudo
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s+/g, '');
  return { pfx: Buffer.from(base64, 'base64'), passphrase };
}

/**
 * O token da resposta, com a hora em que deixa de valer — um minuto antes da
 * do banco, para não chegar vencido.
 *
 * A especificação traz `accessToken`/`expiresAt` e o portal fala em
 * `access_token`/`expires_in`: aceita os dois. `expiresAt` grande é instante
 * (segundos desde 1970); pequeno, duração.
 */
export function lerToken(
  corpo: unknown,
  agora: number,
): { valor: string; ate: number } | null {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const valor = texto(c.access_token ?? c.accessToken);
  if (!valor) return null;
  const n = Number(c.expires_in ?? c.expiresIn ?? c.expiresAt ?? 300);
  const segundos = !Number.isFinite(n) || n <= 0 ? 300 : n > 1e9 ? n - agora / 1000 : n;
  return { valor, ate: agora + Math.max(0, segundos - 60) * 1000 };
}

export function lerSituacaoDoPix(d: Record<string, unknown>): SituacaoDoPagamento {
  return {
    status: status(d.status),
    codigoDoErro: texto(d.errorCode),
    idNoBanco: texto(d.endToEndId),
    liquidadoEm: data(d.settleDate ?? d.eventDate),
  };
}

/** O que o banco disse, no formato RFC 7807 que ele usa (`detail`, `title`). */
export function mensagemDoBanco(r: Pick<AxiosResponse, 'status' | 'data'>): string {
  const d = (r.data ?? {}) as Record<string, unknown>;
  const partes = [texto(d.detail), texto(d.title), texto(d.message)].filter(Boolean);
  const tipo = texto(d.type);
  const codigo = tipo && /onz-\d+/i.test(tipo) ? tipo.match(/onz-\d+/i)![0] : null;
  const frase = partes[0] ?? `HTTP ${r.status}`;
  return codigo && !frase.includes(codigo) ? `${frase} (${codigo})` : frase;
}

export function explicarFalhaDeRede(msg: string): string {
  if (/mac verify|bad decrypt|pkcs12|unsupported|asn1|wrong tag|no start line/i.test(msg)) {
    return (
      'O certificado do ModoBank não abriu: a senha não confere com o arquivo, ' +
      `ou o arquivo veio cortado ao colar no servidor (${msg}).`
    );
  }
  if (/timeout/i.test(msg)) return `O ModoBank não respondeu a tempo (${msg}).`;
  return `Não deu para falar com o ModoBank (${msg}).`;
}

function status(v: unknown): StatusDoBanco | null {
  const s = texto(v)?.toUpperCase();
  return (s as StatusDoBanco | undefined) ?? null;
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function data(v: unknown): Date | null {
  const s = texto(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function centavos(v: number): number {
  return Math.round(v * 100) / 100;
}
