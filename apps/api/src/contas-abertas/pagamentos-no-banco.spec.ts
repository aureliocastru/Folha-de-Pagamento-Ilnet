import { BadRequestException } from '@nestjs/common';
import {
  certificado,
  explicarFalhaDeRede,
  lerToken,
  mensagemDoBanco,
  RecusaDoBanco,
  type BoletoNoBanco,
} from '../modobank/modobank.client';
import { PagamentosNoBancoPoller } from './pagamentos-no-banco.poller';
import {
  chaveParaOBanco,
  comoPagar,
  cpfValido,
  diaEmBrasilia,
  novaChave,
  situacaoDoStatus,
} from './pagamentos-no-banco.regras';
import { PagamentosNoBancoService } from './pagamentos-no-banco.service';
import { PagamentosService } from './pagamentos.service';

/**
 * Pagar pelo ModoBank direto na API dele. O que este arquivo protege:
 *
 *  - o mesmo título não vai ao banco duas vezes — nem daqui, nem depois de a
 *    tela do IXC já tê-lo mandado;
 *  - a chave Pix vai do jeito que o diretório do Pix a guarda, e onze dígitos
 *    ambíguos não pagam a pessoa errada;
 *  - recusa do banco não deixa nada pela metade, e resposta perdida não vira
 *    "não saiu";
 *  - a baixa no IXC só sai quando o banco diz que pagou, pelo valor que saiu.
 */

describe('comoPagar', () => {
  it('título com código de barras é boleto, mesmo com chave anotada', () => {
    expect(
      comoPagar({
        codigo_barras: '23793.38128 60000.000003 00000.000400 1 84340000010000',
        chave_pix: 'fulano@email.com',
      }),
    ).toEqual({ forma: 'BOLETO', codigo: '23793381286000000000300000000400184340000010000' });
  });

  it('chave por e-mail, CNPJ, celular e aleatória sem hífens', () => {
    expect(comoPagar({ chave_pix: ' Fulano@Email.com ' })).toMatchObject({
      forma: 'PIX',
      copiaECola: false,
      chave: 'fulano@email.com',
    });
    expect(comoPagar({ chave_pix: '12.345.678/0001-95' })).toMatchObject({
      chave: '12345678000195',
    });
    expect(comoPagar({ chave_pix: '(49) 99999-1234' })).toMatchObject({
      chave: '+5549999991234',
      alternativa: null,
    });
    expect(comoPagar({ chave_pix: '123e4567e89b12d3a456426614174000' })).toMatchObject({
      chave: '123e4567-e89b-12d3-a456-426614174000',
    });
  });

  it('copia e cola guardado no campo da chave vai como copia e cola', () => {
    const codigo = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR';
    expect(comoPagar({ chave_pix: codigo })).toEqual({
      forma: 'PIX',
      copiaECola: true,
      codigo,
    });
  });

  it('onze dígitos que são CPF válido e parecem celular: CPF, com o celular de reserva', () => {
    // 11999999999 não é CPF válido; 21987654382 é.
    expect(cpfValido('21987654382')).toBe(true);
    expect(comoPagar({ chave_pix: '219.876.543-82' })).toEqual({
      forma: 'PIX',
      copiaECola: false,
      chave: '21987654382',
      alternativa: '+5521987654382',
    });
  });

  it('o rádio legível do IXC decide o tipo', () => {
    expect(
      comoPagar({ chave_pix: '21987654382', tipo_chave_pix: 'Celular' }),
    ).toMatchObject({ chave: '+5521987654382', alternativa: null });
  });

  it('sem código de barras e sem chave, não há por onde pagar', () => {
    expect(comoPagar({ codigo_barras: '', chave_pix: ' ' })).toBeNull();
    expect(comoPagar({ codigo_barras: '123' })).toBeNull();
  });
});

describe('regras do banco', () => {
  it('status do banco vira a situação daqui', () => {
    expect(situacaoDoStatus('LIQUIDATED', 'NO_BANCO')).toBe('PAGO');
    expect(situacaoDoStatus('WAITING_APPROVAL', 'ENVIANDO')).toBe('AGUARDANDO_APROVACAO');
    expect(situacaoDoStatus('CANCELED', 'AGUARDANDO_APROVACAO')).toBe('RECUSADO');
    expect(situacaoDoStatus('ON_QUEUE', 'ENVIANDO')).toBe('NO_BANCO');
    // Status desconhecido não dá por pago.
    expect(situacaoDoStatus(null, 'NO_BANCO')).toBe('NO_BANCO');
    expect(situacaoDoStatus('PARTIALLY_REFUNDED', 'PAGO')).toBe('PAGO');
  });

  it('a chave de idempotência cabe no que o banco aceita', () => {
    const chave = novaChave(31646);
    expect(chave).toMatch(/^[a-zA-Z0-9]{1,50}$/);
    expect(chave).toContain('31646');
    expect(novaChave(31646)).not.toBe(chave);
  });

  it('o dia do pagamento é o de Brasília, não o de Greenwich', () => {
    // 01h de 20/10 em UTC ainda é 22h de 19/10 aqui.
    expect(diaEmBrasilia(new Date('2026-10-20T01:00:00Z'))).toBe('2026-10-19');
  });

  it('celular com 55 e com +', () => {
    expect(chaveParaOBanco('5549999991234', 'Celular')).toBe('+5549999991234');
    expect(chaveParaOBanco('+55 49 99999-1234', 'Celular')).toBe('+5549999991234');
  });
});

describe('cliente do ModoBank', () => {
  it('lê o token nos dois formatos, um minuto antes de vencer', () => {
    const agora = 1_000_000_000_000;
    expect(lerToken({ access_token: 'abc', expires_in: 300 }, agora)).toEqual({
      valor: 'abc',
      ate: agora + 240_000,
    });
    // `expiresAt` grande é instante, em segundos.
    expect(lerToken({ accessToken: 'x', expiresAt: agora / 1000 + 600 }, agora)).toEqual({
      valor: 'x',
      ate: agora + 540_000,
    });
    expect(lerToken({}, agora)).toBeNull();
  });

  it('a recusa diz o que o banco disse, com o código onz', () => {
    expect(
      mensagemDoBanco({
        status: 401,
        data: { type: 'https://x/onz-0001', title: 'INVALID_CREDENTIALS', detail: 'Certificado inválido' },
      }),
    ).toBe('Certificado inválido (onz-0001)');
    expect(mensagemDoBanco({ status: 503, data: '' })).toBe('HTTP 503');
  });

  it('o certificado em base64 aceita o cabeçalho do certutil; PEM vai como PEM', () => {
    const b64 = Buffer.from('conteudo binario').toString('base64');
    const r = certificado(`-----BEGIN CERTIFICATE-----\n${b64.slice(0, 8)}\n${b64.slice(8)}\n-----END CERTIFICATE-----`, 's3nha');
    expect(r).toEqual({ pfx: Buffer.from('conteudo binario'), passphrase: 's3nha' });

    // PEM de verdade traz a chave privada; o do certutil, só o cabeçalho.
    const pem =
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' +
      '-----BEGIN CERTIFICATE-----\nxyz\n-----END CERTIFICATE-----';
    expect(certificado(pem, '')).toEqual({ cert: pem, key: pem, passphrase: undefined });
  });

  it('erro de certificado é dito como erro de certificado', () => {
    expect(explicarFalhaDeRede('mac verify failure')).toMatch(/certificado/);
    expect(explicarFalhaDeRede('timeout of 30000ms exceeded')).toMatch(/a tempo/);
  });
});

/** O título 4242: R$ 1.500,00 pelo ModoBank, com chave Pix. */
const TITULO = {
  id: '4242',
  status: 'A',
  valor: '1500.00',
  valor_aberto: '1500.00',
  id_contas: '18',
  filial_id: '1',
  chave_pix: 'fornecedor@email.com',
};

function montarNoBanco(
  opts: {
    linhas?: Array<Record<string, unknown>>;
    banco?: Partial<Record<string, jest.Mock>>;
  } = {},
) {
  const criadas: Array<Record<string, unknown>> = [];
  const atualizacoes: Array<Record<string, unknown>> = [];
  const prisma = {
    pagamentoNoBanco: {
      findFirst: jest.fn(async () => opts.linhas?.[0] ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const linha = { id: 'p1', situacao: 'ENVIANDO', createdAt: new Date(), ...data };
        criadas.push(linha);
        return linha;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        atualizacoes.push(data);
        return { ...criadas[0], ...data };
      }),
    },
  };
  const banco = {
    configurado: true,
    fluxo: 'APPROVAL_REQUIRED',
    donoDaChave: jest.fn(async () => ({
      nome: 'FORNECEDOR LTDA',
      documento: '12345678000195',
      banco: 'BANCO X',
      endToEndId: 'E-CONSULTA',
    })),
    consultarBoleto: jest.fn(),
    pagarPix: jest.fn(async () => ({ idNoBanco: 'E123', status: 'WAITING_APPROVAL' })),
    pagarBoleto: jest.fn(),
    ...opts.banco,
  };
  const service = new PagamentosNoBancoService(banco as never, prisma as never, {} as never);
  return { service, banco, prisma, criadas, atualizacoes };
}

describe('PagamentosNoBancoService.enviar', () => {
  it('Pix por chave: grava antes, manda com a consulta junto, e fica esperando aprovação', async () => {
    const { service, banco, criadas, atualizacoes } = montarNoBanco();

    const r = await service.enviar(4242, TITULO, { valorDoTitulo: 1500, desconto: 0 });

    expect(criadas[0]).toMatchObject({
      idFnApagar: 4242,
      forma: 'PIX',
      destino: 'fornecedor@email.com',
      favorecido: 'FORNECEDOR LTDA',
      valor: 1500,
    });
    expect(banco.pagarPix).toHaveBeenCalledWith(
      expect.objectContaining({
        destino: 'fornecedor@email.com',
        valor: 1500,
        chave: criadas[0].chave,
        endToEndIdDaConsulta: 'E-CONSULTA',
      }),
    );
    expect(atualizacoes[0]).toMatchObject({
      idNoBanco: 'E123',
      situacao: 'AGUARDANDO_APROVACAO',
    });
    expect(r.pagamento.situacao).toBe('AGUARDANDO_APROVACAO');
  });

  it('no Pix o desconto vale: sai o líquido', async () => {
    const { service, banco } = montarNoBanco();
    await service.enviar(4242, TITULO, { valorDoTitulo: 1500, desconto: 100 });
    expect(banco.pagarPix).toHaveBeenCalledWith(expect.objectContaining({ valor: 1400 }));
  });

  it('título já comunicado pela tela do IXC não vai de novo', async () => {
    const { service, banco } = montarNoBanco();
    await expect(
      service.enviar(4242, { ...TITULO, comunicado: 'S' }, { valorDoTitulo: 1500, desconto: 0 }),
    ).rejects.toThrow(/tela do IXC/);
    expect(banco.pagarPix).not.toHaveBeenCalled();
  });

  it('título já mandado daqui não vai de novo', async () => {
    const { service, banco } = montarNoBanco({
      linhas: [{ situacao: 'AGUARDANDO_APROVACAO', createdAt: new Date() }],
    });
    await expect(
      service.enviar(4242, TITULO, { valorDoTitulo: 1500, desconto: 0 }),
    ).rejects.toThrow(/já foi mandado ao banco/);
    expect(banco.pagarPix).not.toHaveBeenCalled();
  });

  it('a recusa do banco fica anotada e nada fica pela metade', async () => {
    const { service, atualizacoes } = montarNoBanco({
      banco: {
        pagarPix: jest.fn(async () => {
          throw new RecusaDoBanco('ModoBank: saldo insuficiente', 422);
        }),
      },
    });
    await expect(
      service.enviar(4242, TITULO, { valorDoTitulo: 1500, desconto: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(atualizacoes[0]).toMatchObject({ situacao: 'RECUSADO' });
  });

  it('resposta perdida não é "não saiu": a linha fica ENVIANDO para conferir', async () => {
    const { service, atualizacoes } = montarNoBanco({
      banco: {
        pagarPix: jest.fn(async () => {
          throw new Error('socket hang up');
        }),
      },
    });
    const r = await service.enviar(4242, TITULO, { valorDoTitulo: 1500, desconto: 0 });
    expect(r.pagamento.situacao).toBe('ENVIANDO');
    expect(atualizacoes).toHaveLength(0);
    expect(r.avisos.join(' ')).toMatch(/não mande de novo/);
  });

  it('CPF que não existe no Pix tenta o celular com os mesmos dígitos', async () => {
    const donoDaChave = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ nome: 'JOAO', documento: null, banco: null, endToEndId: null });
    const { service, banco } = montarNoBanco({ banco: { donoDaChave } });

    await service.enviar(4242, { ...TITULO, chave_pix: '21987654382' }, {
      valorDoTitulo: 1500,
      desconto: 0,
    });

    expect(donoDaChave.mock.calls.map((c) => c[0])).toEqual(['21987654382', '+5521987654382']);
    expect(banco.pagarPix).toHaveBeenCalledWith(
      expect.objectContaining({ destino: '+5521987654382' }),
    );
  });

  it('chave que não existe no Pix é recusada antes de pagar', async () => {
    const { service, banco } = montarNoBanco({ banco: { donoDaChave: jest.fn(async () => null) } });
    await expect(
      service.enviar(4242, TITULO, { valorDoTitulo: 1500, desconto: 0 }),
    ).rejects.toThrow(/não existe no Pix/);
    expect(banco.pagarPix).not.toHaveBeenCalled();
  });

  it('boleto vai pelo valor que o banco calcula, e boleto de valor livre é recusado', async () => {
    const consultarBoleto = jest.fn(
      async (): Promise<BoletoNoBanco> => ({
        linhaDigitavel: '2379'.padEnd(47, '0'),
        favorecido: 'COPEL',
        documentoDoFavorecido: null,
        vencimento: null,
        valor: 1532.4,
        valorOriginal: 1500,
        valorLivre: false,
      }),
    );
    const pagarBoleto = jest.fn(async () => ({ idNoBanco: '991', status: 'PROCESSING' }));
    const { service } = montarNoBanco({ banco: { consultarBoleto, pagarBoleto } });

    const r = await service.enviar(
      4242,
      { ...TITULO, chave_pix: '', codigo_barras: '2379'.padEnd(44, '0') },
      { valorDoTitulo: 1500, desconto: 0 },
    );
    expect(pagarBoleto).toHaveBeenCalledWith(expect.objectContaining({ valor: 1532.4 }));
    expect(r.pagamento).toMatchObject({ situacao: 'NO_BANCO', valor: 1532.4 });

    consultarBoleto.mockResolvedValueOnce({
      linhaDigitavel: '1',
      favorecido: null,
      documentoDoFavorecido: null,
      vencimento: null,
      valor: 0,
      valorOriginal: null,
      valorLivre: true,
    });
    await expect(
      service.enviar(
        4242,
        { ...TITULO, chave_pix: '', codigo_barras: '2379'.padEnd(44, '0') },
        { valorDoTitulo: 1500, desconto: 0 },
      ),
    ).rejects.toThrow(/escolher o valor/);
  });
});

describe('PagamentosService.pagar — enviar ao banco', () => {
  function montar(noBancoAtivo: boolean) {
    const criados: string[] = [];
    const ixc = {
      getById: jest.fn(async () => ({ ...TITULO })),
      create: jest.fn(async (recurso: string) => {
        criados.push(recurso);
        return { id: 1, raw: {} };
      }),
      action: jest.fn(async (recurso: string) => {
        criados.push(recurso);
        return {};
      }),
    };
    const config = {
      obter: jest.fn().mockResolvedValue({ contaPagamentoId: 18, contaPagamentoCaixaId: 23, filialId: 1 }),
    };
    const noBanco = {
      ativo: noBancoAtivo,
      enviar: jest.fn(async () => ({
        pagamento: { valor: 1500, situacao: 'AGUARDANDO_APROVACAO', forma: 'PIX', favorecido: 'FORNECEDOR LTDA' },
        avisos: [],
      })),
    };
    const service = new PagamentosService(
      ixc as never,
      config as never,
      {} as never,
      {} as never,
      noBanco as never,
    );
    return { service, criados, noBanco };
  }

  it('pelo ModoBank com a API ligada: manda ao banco e não toca no IXC', async () => {
    const { service, criados, noBanco } = montar(true);

    const r = await service.pagar(4242, { enviarAoBanco: true }, 'Aurelio');

    expect(noBanco.enviar).toHaveBeenCalledWith(4242, expect.anything(), {
      valorDoTitulo: 1500,
      desconto: 0,
      usuario: 'Aurelio',
    });
    // Nem auditoria nem baixa: as duas saem quando o banco pagar.
    expect(criados).toEqual([]);
    expect(r).toMatchObject({
      paga: false,
      aguardandoBanco: true,
      noBanco: { situacao: 'AGUARDANDO_APROVACAO', favorecido: 'FORNECEDOR LTDA' },
    });
  });

  it('sem a API ligada, só aprova como antes e avisa', async () => {
    const { service, criados, noBanco } = montar(false);

    const r = await service.pagar(4242, { enviarAoBanco: true });

    expect(noBanco.enviar).not.toHaveBeenCalled();
    expect(criados).toEqual(['fn_apagar_auditoria']);
    expect(r.avisos.join(' ')).toMatch(/não está ligado/);
  });

  it('outra conta não vai ao banco, mesmo pedindo', async () => {
    const { service, noBanco } = montar(true);
    await service.pagar(4242, { enviarAoBanco: true, contaPagamento: 23 }).catch(() => undefined);
    expect(noBanco.enviar).not.toHaveBeenCalled();
  });
});

describe('PagamentosNoBancoPoller — a baixa do que o banco pagou', () => {
  function montar(titulo: Record<string, unknown>, linha: Record<string, unknown> = {}) {
    const pago: Record<string, unknown> = {
      id: 'p1',
      idFnApagar: 4242,
      forma: 'BOLETO',
      valor: 1532.4,
      situacao: 'PAGO',
      idNoBanco: 'b1',
      baixadoEm: null,
      erro: null,
      comprovanteEm: null,
      comprovanteErro: null,
      pagoEm: new Date('2026-10-19T15:00:00Z'),
      updatedAt: new Date(),
      createdAt: new Date(),
      ...linha,
    };
    const prisma = {
      pagamentoNoBanco: {
        findMany: jest.fn(async () => [pago]),
        findUnique: jest.fn(async () => pago),
        // A linha guarda o que se gravou: a baixa vale para o comprovante logo depois.
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(pago, data)),
      },
    };
    const pagamentos = { pagar: jest.fn(async () => ({ paga: true })) };
    const config = { obter: jest.fn().mockResolvedValue({ contaPagamentoId: 18 }) };
    const ixc = { getById: jest.fn(async () => titulo) };
    const noBanco = { ativo: true, atualizar: jest.fn(), anexarComprovante: jest.fn(async () => true) };
    const poller = new PagamentosNoBancoPoller(
      noBanco as never,
      pagamentos as never,
      config as never,
      prisma as never,
      ixc as never,
    );
    return { poller, pagamentos, prisma, noBanco };
  }

  it('baixado, anexa o comprovante do banco no título', async () => {
    const { poller, noBanco } = montar({ ...TITULO });
    await poller.acompanhar();
    expect(noBanco.anexarComprovante).toHaveBeenCalledWith(
      expect.objectContaining({ idFnApagar: 4242, baixadoEm: expect.any(Date) }),
    );
  });

  it('o pago de antes, já baixado, ganha o comprovante que faltava', async () => {
    const { poller, pagamentos, noBanco } = montar({ ...TITULO }, { baixadoEm: new Date() });
    await poller.acompanhar();
    expect(pagamentos.pagar).not.toHaveBeenCalled();
    expect(noBanco.anexarComprovante).toHaveBeenCalled();
  });

  it('logo depois de uma falha no comprovante, espera antes de pedir de novo', async () => {
    const { poller, noBanco } = montar(
      { ...TITULO },
      { baixadoEm: new Date(), comprovanteErro: 'O banco não devolveu o comprovante.' },
    );
    await poller.acompanhar();
    expect(noBanco.anexarComprovante).not.toHaveBeenCalled();
  });

  it('baixa na conta do ModoBank, no dia em que saiu, pelo valor que saiu', async () => {
    const { poller, pagamentos, prisma } = montar({ ...TITULO });

    await poller.acompanhar();

    expect(pagamentos.pagar).toHaveBeenCalledWith(
      4242,
      {
        contaPagamento: 18,
        jaSaiu: true,
        data: '2026-10-19',
        // O boleto saiu com juros: o título sobe para o que saiu.
        valorPago: 1532.4,
        desconto: undefined,
      },
      'ModoBank',
    );
    expect(prisma.pagamentoNoBanco.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ erro: null }) }),
    );
  });

  it('título que já consta pago no IXC não é baixado de novo', async () => {
    const { poller, pagamentos } = montar({
      ...TITULO,
      status: 'F',
      valor_aberto: '0',
      data_pagamento: '19/10/2026',
    });

    await poller.acompanhar();

    expect(pagamentos.pagar).not.toHaveBeenCalled();
  });
});
