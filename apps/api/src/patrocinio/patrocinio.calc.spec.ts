import { FormaPagamento, OrigemDoContrato, StatusContaPagar } from '@prisma/client';
import { blocosDoContrato, CONTRATO_PADRAO } from './contrato.texto';
import {
  resumirPagamentos,
  situacaoDoContrato,
  situacaoDoPagamento,
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

describe('situacaoDoPagamento', () => {
  const base = { valor: 300, data: AGORA };

  it('em mãos antiga, sem conta a pagar, saiu da gaveta no ato', () => {
    expect(situacaoDoPagamento({ ...base, forma: FormaPagamento.EM_MAOS, contaPagar: null })).toBe('PAGO');
  });

  it('pelo IXC sem conta a pagar travou: o dinheiro não saiu', () => {
    expect(situacaoDoPagamento({ ...base, forma: FormaPagamento.IXC, contaPagar: null })).toBe('NAO_SAIU');
  });

  it('segue o status da conta a pagar', () => {
    const com = (status: StatusContaPagar) =>
      situacaoDoPagamento({ ...base, forma: FormaPagamento.IXC, contaPagar: { status } });
    expect(com(StatusContaPagar.PAGO)).toBe('PAGO');
    expect(com(StatusContaPagar.REPROVADO)).toBe('NAO_SAIU');
    expect(com(StatusContaPagar.CANCELADO)).toBe('NAO_SAIU');
    expect(com(StatusContaPagar.ERRO)).toBe('NAO_SAIU');
  });
});

describe('resumirPagamentos', () => {
  it('soma só o que saiu, arredondado no centavo, e acha o último pago', () => {
    const r = resumirPagamentos([
      { valor: 0.1, data: ONTEM, forma: FormaPagamento.EM_MAOS, contaPagar: null },
      { valor: 0.2, data: AGORA, forma: FormaPagamento.IXC, contaPagar: { status: StatusContaPagar.PAGO } },
      // O mais recente ainda espera o banco: não é "o último que mandei".
      { valor: 500, data: AMANHA, forma: FormaPagamento.IXC, contaPagar: null },
    ]);
    expect(r.totalPago).toBe(0.3);
    expect(r.quantidadePagos).toBe(2);
    expect(r.ultimoPagamento).toEqual(AGORA);
  });

  it('sem pagamento nenhum', () => {
    expect(resumirPagamentos([])).toEqual({
      totalPago: 0,
      quantidadePagos: 0,
      totalAguardando: 0,
      ultimoPagamento: null,
    });
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
