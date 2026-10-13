import { ServiceUnavailableException } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import { IxcClient, motivoDaRecusa } from './ixc.client';

function makeHttp(requestImpl: jest.Mock): AxiosInstance {
  return { request: requestImpl } as unknown as AxiosInstance;
}

describe('IxcClient.list', () => {
  it('monta o body de listagem e envia header ixcsoft', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: { total: '2', registros: [{ id: '1' }, { id: '2' }] },
    });
    const client = new IxcClient(makeHttp(request));

    const res = await client.list('funcionarios', {
      qtype: 'funcionarios.id',
      query: '1',
      oper: '>=',
    });

    expect(res.total).toBe(2);
    expect(res.registros).toHaveLength(2);

    const call = request.mock.calls[0][0];
    expect(call.method).toBe('GET');
    expect(call.url).toBe('/funcionarios');
    expect(call.headers.ixcsoft).toBe('listar');
    expect(call.data).toMatchObject({
      qtype: 'funcionarios.id',
      query: '1',
      oper: '>=',
      page: '1',
    });
  });

  it('trata erro lógico do IXC (type=error) como 503', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: { type: 'error', message: 'token inválido' },
    });
    const client = new IxcClient(makeHttp(request));

    await expect(
      client.list('funcionarios', { qtype: 'funcionarios.id', query: '1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('converte falha de rede em ServiceUnavailable', async () => {
    const request = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new IxcClient(makeHttp(request));

    await expect(
      client.list('funcionarios', { qtype: 'funcionarios.id', query: '1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('IxcClient.listAll', () => {
  it('pagina até coletar todos os registros', async () => {
    const request = jest
      .fn()
      // página 1 cheia (2 de 3)
      .mockResolvedValueOnce({
        status: 200,
        data: { total: '3', registros: [{ id: '1' }, { id: '2' }] },
      })
      // página 2 com o restante
      .mockResolvedValueOnce({
        status: 200,
        data: { total: '3', registros: [{ id: '3' }] },
      });
    const client = new IxcClient(makeHttp(request));

    const all = await client.listAll(
      'funcionarios',
      { qtype: 'funcionarios.id', query: '1', oper: '>=' },
      { pageSize: 2 },
    );

    expect(all.map((r: any) => r.id)).toEqual(['1', '2', '3']);
    expect(request).toHaveBeenCalledTimes(2);
  });

  /** Uma base de mentira: `total` registros, e a página `n` responde depois de `atraso(n)` ms. */
  function base(total: number, atraso: (pagina: number) => number = () => 0, totalDito = total) {
    let simultaneos = 0;
    let pico = 0;
    const request = jest.fn(async ({ data }: { data: { page: string; rp: string } }) => {
      const pagina = Number(data.page);
      const rp = Number(data.rp);
      simultaneos += 1;
      pico = Math.max(pico, simultaneos);
      await new Promise((r) => setTimeout(r, atraso(pagina)));
      simultaneos -= 1;
      const de = (pagina - 1) * rp;
      const registros = Array.from({ length: Math.max(0, Math.min(rp, total - de)) }, (_, i) => ({
        id: String(de + i + 1),
      }));
      return { status: 200, data: { total: String(totalDito), registros } };
    });
    return { request, pico: () => pico };
  }

  it('pede as páginas em lotes e devolve na ordem, mesmo chegando fora de ordem', async () => {
    // As páginas pares respondem antes das ímpares.
    const { request, pico } = base(23, (p) => (p % 2 ? 15 : 1));
    const client = new IxcClient(makeHttp(request));

    const all = await client.listAll('x', { qtype: 'x.id', query: '0', oper: '>' }, { pageSize: 2 });

    expect(all.map((r: any) => Number(r.id))).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    expect(request).toHaveBeenCalledTimes(12);
    expect(pico()).toBe(4);
  });

  it('um total exagerado custa no máximo um lote a mais, e não centenas de pedidos', async () => {
    const { request } = base(5, () => 0, 100_000);
    const client = new IxcClient(makeHttp(request));

    const all = await client.listAll('x', { qtype: 'x.id', query: '0', oper: '>' }, { pageSize: 2 });

    expect(all).toHaveLength(5);
    expect(request.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('sem total, fica com a primeira página', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: { registros: [{ id: '1' }, { id: '2' }] },
    });
    const client = new IxcClient(makeHttp(request));

    const all = await client.listAll('x', { qtype: 'x.id', query: '0', oper: '>' }, { pageSize: 2 });

    expect(all).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

/**
 * O IXC recusa de dois jeitos: pelo status HTTP e por `type: "error"` com HTTP
 * 200. No segundo, ele nem sempre manda `message` — e a mensagem antiga saía
 * literalmente "HTTP 200", um código de sucesso apresentado como falha. Quem
 * lia isso na tela não tinha o que fazer com a informação, e quem fosse
 * investigar também não.
 */
describe('motivoDaRecusa', () => {
  it('usa a mensagem do IXC quando ela existe', () => {
    expect(
      motivoDaRecusa(200, { type: 'error', message: 'Conta já baixada' }),
    ).toBe('Conta já baixada');
  });

  it('sem mensagem, diz que não houve motivo e mostra o que veio', () => {
    const m = motivoDaRecusa(200, { type: 'error' });

    expect(m).toContain('recusou sem dizer o motivo');
    expect(m).toContain('HTTP 200');
    expect(m).toContain('{"type":"error"}');
  });

  it('corpo vazio não vira ruído na mensagem', () => {
    expect(motivoDaRecusa(500, {})).toBe(
      'recusou sem dizer o motivo (HTTP 500)',
    );
  });

  /** Resposta em HTML (o IXC faz isso quando quebra de verdade) não pode
      empurrar uma página inteira para dentro do aviso da tela. */
  it('corta corpo comprido', () => {
    const m = motivoDaRecusa(200, '<html>' + 'x'.repeat(1000) + '</html>');

    expect(m.length).toBeLessThan(360);
  });

  it('mensagem só de espaços conta como ausente', () => {
    expect(motivoDaRecusa(200, { type: 'error', message: '   ' })).toContain(
      'recusou sem dizer o motivo',
    );
  });
});

/**
 * Onde o IXC escreve o motivo. Visto em producao, na baixa de conta a pagar:
 *
 *   {"type":"error","valor":"Erro inesperado, tente novamente!"}
 *
 * O motivo existia e era descartado por estar fora de `message`.
 */
describe('motivoDaRecusa — onde o IXC escreve o motivo', () => {
  it('le o motivo de `valor`, como vem nas baixas', () => {
    expect(
      motivoDaRecusa(200, {
        type: 'error',
        valor: 'Erro inesperado, tente novamente!',
      }),
    ).toBe('Erro inesperado, tente novamente!');
  });

  it('le tambem de `mensagem`', () => {
    expect(motivoDaRecusa(200, { type: 'error', mensagem: 'Sem saldo' })).toBe(
      'Sem saldo',
    );
  });

  /** `message` continua sendo a primeira escolha quando as duas vem. */
  it('message tem preferencia sobre valor', () => {
    expect(
      motivoDaRecusa(200, { type: 'error', message: 'A', valor: 'B' }),
    ).toBe('A');
  });
});

/**
 * O anexo é o único caminho desta casa que não vai em JSON, e o modo dele
 * falhar é o pior que existe: o IXC responde "deu certo" e não guarda nada.
 *
 * Foi o que aconteceu na primeira versão. A instância do axios daqui fixa
 * `Content-Type: application/json` para todas as chamadas — as listagens
 * precisam disso —, e esse cabeçalho vencia o que o axios calcularia sozinho
 * para um `FormData`: o IXC recebia um multipart rotulado como JSON, não achava
 * separador nenhum e a aba de arquivos do título continuava vazia.
 */
describe('IxcClient.upload', () => {
  const arquivo = {
    nome: 'cupom.png',
    tipo: 'image/png',
    conteudo: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  };

  async function subir() {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: { type: 'success', id: '77' },
    });
    const client = new IxcClient(makeHttp(request));
    await client.upload('fn_apagar_arquivos', 'arquivo', arquivo, {
      id_apagar: '4242',
      descricao: 'Nota',
    });
    return request.mock.calls[0][0];
  }

  it('manda multipart, com o boundary no cabeçalho', async () => {
    const call = await subir();

    expect(call.method).toBe('post');
    expect(call.url).toBe('/fn_apagar_arquivos');
    const tipo = call.headers['Content-Type'] as string;
    expect(tipo).toMatch(/^multipart\/form-data; boundary=/);
    // O mesmo boundary tem de abrir o corpo, ou o IXC não separa nada.
    const boundary = tipo.split('boundary=')[1];
    expect((call.data as Buffer).toString('latin1')).toContain(`--${boundary}`);
  });

  it('leva os campos de texto e o arquivo com nome e tipo', async () => {
    const call = await subir();
    const corpo = (call.data as Buffer).toString('latin1');

    expect(corpo).toContain('name="id_apagar"');
    expect(corpo).toContain('4242');
    expect(corpo).toContain('name="descricao"');
    expect(corpo).toContain('name="arquivo"; filename="cupom.png"');
    expect(corpo).toContain('Content-Type: image/png');
  });

  /* O binário sai byte a byte: um PNG que passe por conversão de texto vira
     um arquivo que não abre. */
  it('não estraga o binário no caminho', async () => {
    const call = await subir();
    const corpo = call.data as Buffer;

    expect(corpo.includes(arquivo.conteudo)).toBe(true);
    expect(call.headers['Content-Length']).toBe(String(corpo.length));
  });
});
