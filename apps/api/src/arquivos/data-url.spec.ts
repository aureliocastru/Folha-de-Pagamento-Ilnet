import { tipoPeloConteudo } from './data-url';

/**
 * O tipo de um arquivo pelos primeiros bytes. É o que decide se a nota abre
 * como foto ou como PDF — e o nome que o IXC guardou nem sempre diz a verdade.
 */
describe('tipoPeloConteudo', () => {
  const comeco = (...bytes: number[]) =>
    Buffer.concat([Buffer.from(bytes), Buffer.alloc(32)]);

  it('reconhece PDF, JPEG, PNG e GIF', () => {
    expect(tipoPeloConteudo(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(tipoPeloConteudo(comeco(0xff, 0xd8, 0xff, 0xe1))).toBe('image/jpeg');
    expect(tipoPeloConteudo(comeco(0x89, 0x50, 0x4e, 0x47))).toBe('image/png');
    expect(tipoPeloConteudo(Buffer.from('GIF89a......'))).toBe('image/gif');
  });

  it('reconhece WebP pela marca, e não só pelo RIFF', () => {
    expect(tipoPeloConteudo(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    // RIFF também é WAV e AVI: sem a marca, não é foto.
    expect(tipoPeloConteudo(Buffer.from('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
  });

  it('reconhece o HEIC do iPhone', () => {
    expect(tipoPeloConteudo(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0'))).toBe(
      'image/heic',
    );
  });

  it('o que não reconhece fica sem tipo', () => {
    expect(tipoPeloConteudo(Buffer.from('a'.repeat(40)))).toBeNull();
  });
});
