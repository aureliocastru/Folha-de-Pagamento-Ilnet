import { OrigemDoContrato } from '@prisma/client';
import { blocosDoContrato, CONTRATO_PADRAO } from './contrato.texto';
import {
  pagamentoDoTitulo,
  pagamentosDoMes,
  resumirPagamentos,
  situacaoDoContrato,
  situacaoDoMes,
  type PagamentoAoPatrocinado,
} from './patrocinio.calc';

const AGORA = new Date('2026-10-14T12:00:00Z');
const AMANHA = new Date('2026-10-15T12:00:00Z');
const ONTEM = new Date('2026-10-13T12:00:00Z');

describe('situacaoDoContrato', () => {
  it('sem contrato nenhum', () => {
    expect(situacaoDoContrato([], AGORA)).toBe('SEM_CONTRATO');
  });

  it('o escaneado vale mesmo sem a data do papel', () => {
    expect(
      situacaoDoContrato(
        [{ origem: OrigemDoContrato.ESCANEADO, assinadoEm: null, expiraEm: null }],
        AGORA,
      ),
    ).toBe('ASSINADO');
  });

  it('link aberto e no prazo é aguardando; vencido é vencido', () => {
    const aberto = { origem: OrigemDoContrato.LINK, assinadoEm: null, expiraEm: AMANHA };
    const vencido = { origem: OrigemDoContrato.LINK, assinadoEm: null, expiraEm: ONTEM };
    expect(situacaoDoContrato([aberto], AGORA)).toBe('AGUARDANDO');
    expect(situacaoDoContrato([vencido], AGORA)).toBe('VENCIDO');
  });

  it('um assinado manda mais que um link novo aberto (a renovação em curso)', () => {
    expect(
      situacaoDoContrato(
        [
          { origem: OrigemDoContrato.LINK, assinadoEm: null, expiraEm: AMANHA },
          { origem: OrigemDoContrato.LINK, assinadoEm: ONTEM, expiraEm: ONTEM },
        ],
        AGORA,
      ),
    ).toBe('ASSINADO');
  });
});

describe('pagamentoDoTitulo', () => {
  const titulo = {
    id: '501',
    id_fornecedor: '77',
    valor: '300.00',
    data_vencimento: '2026-10-05',
    obs: 'Patrocínio Maria Clara - outubro de 2026',
  };

  it('título baixado é pago, com o dia e o que saiu', () => {
    const p = pagamentoDoTitulo(
      { ...titulo, status: 'F', valor_pago: '310.00', valor_aberto: '0', data_pagamento: '2026-10-07 09:00:00' },
      77,
    );
    expect(p).toMatchObject({ idFnApagar: 501, situacao: 'PAGO', valor: 310 });
    expect(p?.pagoEm?.toISOString().slice(0, 10)).toBe('2026-10-07');
    expect(p?.descricao).toBe('Patrocínio Maria Clara - outubro de 2026');
  });

  it('título com saldo é em aberto, pelo que falta', () => {
    const p = pagamentoDoTitulo({ ...titulo, status: 'A', valor_aberto: '300.00' }, 77);
    expect(p).toMatchObject({ situacao: 'EM_ABERTO', valor: 300, pagoEm: null });
  });

  it('cancelado, ou de outro fornecedor, não conta', () => {
    expect(pagamentoDoTitulo({ ...titulo, status: 'C' }, 77)).toBeNull();
    expect(pagamentoDoTitulo({ ...titulo, status: 'A', valor_aberto: '300' }, 12)).toBeNull();
  });
});

function pagamento(p: Partial<PagamentoAoPatrocinado>): PagamentoAoPatrocinado {
  return {
    idFnApagar: 1,
    situacao: 'PAGO',
    valor: 0,
    vencimento: null,
    pagoEm: null,
    descricao: null,
    documento: null,
    ...p,
  };
}

describe('resumirPagamentos', () => {
  it('soma só o que saiu, arredondado no centavo, e acha o último pago', () => {
    const r = resumirPagamentos([
      pagamento({ valor: 0.1, pagoEm: ONTEM }),
      pagamento({ valor: 0.2, pagoEm: AGORA }),
      // O mais recente ainda espera o banco: não é "o último que mandei".
      pagamento({ valor: 500, situacao: 'EM_ABERTO', vencimento: AMANHA }),
    ]);
    expect(r.totalPago).toBe(0.3);
    expect(r.quantidadePagos).toBe(2);
    expect(r.totalEmAberto).toBe(500);
    expect(r.ultimoPagamento).toEqual(AGORA);
  });

  it('sem pagamento nenhum', () => {
    expect(resumirPagamentos([])).toEqual({
      totalPago: 0,
      quantidadePagos: 0,
      totalEmAberto: 0,
      ultimoPagamento: null,
    });
  });
});

describe('pagamentosDoMes', () => {
  it('o mês é o do vencimento: o de outubro pago em novembro continua de outubro', () => {
    const outubro = pagamento({
      valor: 300,
      vencimento: new Date('2026-10-31T00:00:00Z'),
      pagoEm: new Date('2026-11-02T00:00:00Z'),
    });
    expect(pagamentosDoMes([outubro], '2026-10').pago).toBe(300);
    expect(pagamentosDoMes([outubro], '2026-11').pago).toBe(0);
  });
});

describe('situacaoDoMes', () => {
  it('com valor combinado', () => {
    expect(situacaoDoMes(300, { pago: 300, emAberto: 0 })).toBe('PAGO');
    expect(situacaoDoMes(300, { pago: 100, emAberto: 200 })).toBe('EM_ABERTO');
    expect(situacaoDoMes(300, { pago: 100, emAberto: 0 })).toBe('PARCIAL');
    expect(situacaoDoMes(300, { pago: 0, emAberto: 0 })).toBe('FALTA');
  });

  it('sem valor combinado não há o que cobrar', () => {
    expect(situacaoDoMes(null, { pago: 0, emAberto: 0 })).toBe('SEM_PAGAMENTO');
    expect(situacaoDoMes(null, { pago: 50, emAberto: 0 })).toBe('PAGO');
    expect(situacaoDoMes(null, { pago: 0, emAberto: 50 })).toBe('EM_ABERTO');
  });
});

describe('blocosDoContrato', () => {
  it('o contrato padrão tem as sete seções do papel, na ordem', () => {
    const secoes = blocosDoContrato(CONTRATO_PADRAO)
      .filter((b) => b.tipo === 'secao')
      .map((b) => b.texto);
    expect(secoes).toEqual([
      '1. Divulgação nas redes sociais',
      '2. Divulgação em eventos e atividades',
      '3. Produção de conteúdo',
      '4. Cuidados com a imagem da empresa',
      '5. Acompanhamento das divulgações',
      '6. Responsabilidades da ILNET',
      '7. Avaliação da parceria',
    ]);
  });

  it('item de lista perde o marcador; linha vazia some', () => {
    expect(blocosDoContrato('Intro\n\n• Um item;\n')).toEqual([
      { tipo: 'paragrafo', texto: 'Intro' },
      { tipo: 'item', texto: 'Um item;' },
    ]);
  });
});
