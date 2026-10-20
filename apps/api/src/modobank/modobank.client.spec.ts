import { barrasDaArrecadacao, formaDaResposta, mensagemDoBanco, pdfDaResposta } from './modobank.client';

/**
 * O comprovante do banco: o manual não diz em que forma ele vem, e a primeira
 * tentativa (`data.pdf`) errou. Vale o PDF de onde ele estiver.
 */
describe('pdfDaResposta', () => {
  const PDF = Buffer.from('%PDF-1.4\n%fim');
  const base64 = PDF.toString('base64');

  it('o PDF cru', () => {
    expect(pdfDaResposta(PDF)?.equals(PDF)).toBe(true);
  });

  it('em base64, em qualquer chave do JSON', () => {
    const corpo = Buffer.from(JSON.stringify({ data: { receipt: { file: base64 } } }));
    expect(pdfDaResposta(corpo)?.equals(PDF)).toBe(true);
  });

  it('com o "data:application/pdf;base64," na frente', () => {
    const corpo = Buffer.from(JSON.stringify({ data: `data:application/pdf;base64,${base64}` }));
    expect(pdfDaResposta(corpo)?.equals(PDF)).toBe(true);
  });

  it('o base64 sozinho, sem JSON', () => {
    expect(pdfDaResposta(Buffer.from(base64))?.equals(PDF)).toBe(true);
  });

  it('sem PDF nenhum, null', () => {
    expect(pdfDaResposta(Buffer.from(JSON.stringify({ data: { status: 'OK' } })))).toBeNull();
  });
});

describe('formaDaResposta', () => {
  it('as chaves e os tamanhos, sem o conteúdo', () => {
    const corpo = Buffer.from(JSON.stringify({ data: { url: 'https://x/y', itens: [1, 2] } }));
    expect(formaDaResposta(corpo)).toBe('{data:{url:texto(11),itens:[2 × number]}}');
  });
});

describe('barrasDaArrecadacao', () => {
  it('a linha de 48 do DARF vira o código de barras de 44, sem os dígitos de conferência', () => {
    const blocos = ['85810000041', '58400328251', '02100000000', '00000000000'];
    const linha = blocos.map((b) => `${b}9`).join('');
    expect(barrasDaArrecadacao(linha)).toBe(blocos.join(''));
  });

  it('boleto bancário não é arrecadação', () => {
    expect(barrasDaArrecadacao('23793381286000000000300000000400184340000010000')).toBeNull();
  });
});

describe('mensagemDoBanco', () => {
  it('a página que o banco manda no lugar do JSON vale pelo título', () => {
    expect(mensagemDoBanco({ status: 500, data: '<html><head><title>Not Found</title></head></html>' })).toBe(
      'HTTP 500: Not Found',
    );
  });
});
