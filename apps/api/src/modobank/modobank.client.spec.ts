import { formaDaResposta, pdfDaResposta } from './modobank.client';

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
