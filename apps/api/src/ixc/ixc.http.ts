import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import type { AppConfig } from '../config/configuration';

export const IXC_HTTP = 'IXC_HTTP';

/**
 * Cria a instância axios já configurada para o webservice do IXC:
 *  - baseURL https://{host}/webservice/v1
 *  - Basic Auth com o token (formato "id:hash") em base64
 *  - Content-Type JSON e timeout configurável
 *
 * O IXC usa o método GET com corpo JSON nas listagens; o adaptador HTTP do
 * axios (Node) envia o corpo normalmente, então isso funciona.
 */
export function createIxcHttp(ixc: AppConfig['ixc']): AxiosInstance {
  const logger = new Logger('IxcHttp');

  if (!ixc.host || !ixc.token) {
    logger.warn(
      'IXC_HOST/IXC_TOKEN não configurados — chamadas ao IXC vão falhar até preencher o .env',
    );
  }

  const token = Buffer.from(ixc.token || '').toString('base64');

  const http = axios.create({
    baseURL: `https://${ixc.host}/webservice/v1`,
    timeout: ixc.timeoutMs,
    headers: {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    },
    // O IXC pode devolver 200 com { type: "error" }; deixamos o cliente tratar.
    validateStatus: (s) => s >= 200 && s < 500,
  });

  if (ixc.somenteLeitura) {
    logger.warn('IXC em modo só leitura (IXC_SOMENTE_LEITURA): toda escrita será recusada.');
    http.interceptors.request.use(recusarEscrita);
  }
  return http;
}

/**
 * A trava do modo só leitura: toda chamada que não é listagem é recusada antes
 * de sair daqui.
 *
 * Existe para subir um ambiente de teste apontando para o IXC de produção — o
 * único que a casa tem — sem depender de lembrar que botão não apertar. As
 * listagens do IXC são GET (com corpo); inserir, editar, apagar e os botões
 * (baixa, auditoria) são POST, PUT e DELETE.
 */
export function recusarEscrita<T extends { method?: string; url?: string }>(pedido: T): T {
  const metodo = (pedido.method ?? 'get').toLowerCase();
  if (metodo !== 'get') {
    throw new Error(
      `IXC em modo só leitura: ${metodo.toUpperCase()} ${pedido.url ?? ''} não foi enviado ` +
        '(tire IXC_SOMENTE_LEITURA do .env para gravar).',
    );
  }
  return pedido;
}

export { AxiosInstance };
export { axios };
