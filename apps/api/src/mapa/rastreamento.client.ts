import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import type { AppConfig } from '../config/configuration';
import type { GrupoDoRastreador } from './frota';

export const RASTREIO_HTTP = 'RASTREIO_HTTP';

/** A instância do axios da plataforma de rastreamento. */
export function criarRastreioHttp(cfg: AppConfig['rastreio']): AxiosInstance {
  return axios.create({
    timeout: cfg.timeoutMs,
    headers: { Accept: 'application/json' },
    // O status é lido aqui: o 401 é o hash vencido, e pede um login novo.
    validateStatus: () => true,
  });
}

/**
 * A plataforma de rastreamento da frota (GPSMOBILE / Waysis). Documentação:
 * https://waysis.com.br/api/gpsmobile.html
 *
 * Duas chamadas só: `POST /login` (e-mail e senha → `user_api_hash`) e
 * `GET /get_devices`, que traz cada veículo com posição, velocidade, rumo, se
 * está online e o rastro recente.
 *
 * O hash pode vir pronto (`RASTREIO_API_HASH`), que é o preferido: com ele a
 * senha da conta não precisa morar no servidor. Com e-mail e senha o hash é
 * gerado aqui, e gerado de novo quando a plataforma o recusar.
 *
 * A plataforma só tem HTTP. O hash vai na URL — por isso nenhuma mensagem de
 * erro daqui cita a URL, só o endereço do servidor.
 */
@Injectable()
export class RastreamentoClient {
  private readonly logger = new Logger(RastreamentoClient.name);
  private readonly cfg: AppConfig['rastreio'];
  private hash: string | null;

  constructor(
    @Inject(RASTREIO_HTTP) private readonly http: AxiosInstance,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<AppConfig['rastreio']>('rastreio');
    this.hash = this.cfg.apiHash || null;
  }

  /** O que falta configurar. Vazio = pronto para ler a frota. */
  problemas(): string[] {
    if (!this.cfg.url) return ['RASTREIO_URL não definido'];
    if (!this.cfg.apiHash && !this.podeEntrar()) {
      return ['Defina RASTREIO_API_HASH, ou RASTREIO_EMAIL e RASTREIO_SENHA'];
    }
    return [];
  }

  get configurado(): boolean {
    return this.problemas().length === 0;
  }

  private podeEntrar(): boolean {
    return Boolean(this.cfg.email && this.cfg.senha);
  }

  private get servidor(): string {
    try {
      return new URL(this.cfg.url).host;
    } catch {
      return 'rastreamento';
    }
  }

  /** Os grupos de veículos da conta, crus (`get_devices`). */
  async grupos(): Promise<GrupoDoRastreador[]> {
    const resposta = await this.chamar('/get_devices');
    if (!Array.isArray(resposta)) {
      throw new ServiceUnavailableException(
        'Rastreamento: resposta inesperada do get_devices (esperava a lista de grupos).',
      );
    }
    return resposta as GrupoDoRastreador[];
  }

  private async chamar(caminho: string): Promise<unknown> {
    if (!this.configurado) {
      throw new ServiceUnavailableException(`Rastreamento não configurado: ${this.problemas().join('; ')}.`);
    }
    if (!this.hash) await this.entrar();

    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const res = await this.pedir(() =>
        this.http.request({
          url: `${this.cfg.url}${caminho}`,
          method: 'GET',
          params: { user_api_hash: this.hash, lang: this.cfg.idioma },
        }),
      );
      if (res.status === 401 && tentativa === 1 && this.podeEntrar()) {
        this.hash = null;
        await this.entrar();
        continue;
      }
      if (res.status === 401) {
        throw new ServiceUnavailableException(
          'O rastreamento recusou as credenciais (HTTP 401). Confira RASTREIO_API_HASH, ou o e-mail e a senha.',
        );
      }
      if (res.status >= 400 || res.data === undefined || res.data === null || typeof res.data === 'string') {
        const corpo = typeof res.data === 'string' ? res.data.slice(0, 160) : '';
        throw new ServiceUnavailableException(
          `O rastreamento respondeu HTTP ${res.status} em ${caminho}${corpo ? `: ${corpo}` : ''}.`,
        );
      }
      return res.data;
    }
    throw new ServiceUnavailableException('Rastreamento: não foi possível autenticar.');
  }

  /** Gera um hash novo com o e-mail e a senha da conta. */
  private async entrar(): Promise<void> {
    if (!this.podeEntrar()) {
      throw new ServiceUnavailableException(
        'O rastreamento recusou o RASTREIO_API_HASH e não há RASTREIO_EMAIL e RASTREIO_SENHA para gerar outro.',
      );
    }
    const res = await this.pedir(() =>
      this.http.request({
        url: `${this.cfg.url}/login`,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({ email: this.cfg.email, password: this.cfg.senha }).toString(),
      }),
    );
    const corpo = (res.data ?? {}) as { status?: unknown; user_api_hash?: unknown; message?: unknown };
    if (Number(corpo.status) === 1 && typeof corpo.user_api_hash === 'string' && corpo.user_api_hash) {
      this.hash = corpo.user_api_hash;
      this.logger.log('Login no rastreamento feito; hash novo guardado.');
      return;
    }
    const motivo = typeof corpo.message === 'string' && corpo.message ? corpo.message : 'sem motivo dito';
    throw new ServiceUnavailableException(`O login no rastreamento falhou (HTTP ${res.status}): ${motivo}.`);
  }

  /** A chamada, com a falha de rede dita sem a URL (ela leva o hash). */
  private async pedir<T>(fazer: () => Promise<T>): Promise<T> {
    try {
      return await fazer();
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      throw new ServiceUnavailableException(`Não foi possível falar com o rastreamento (${this.servidor}): ${motivo}`);
    }
  }
}
