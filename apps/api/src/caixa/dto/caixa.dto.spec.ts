import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AnexarNotaDto, MovimentoDaRuaDto, NotaDto } from './caixa.dto';
import {
  RECADO_DA_FOTO,
  RECADO_DO_PDF_FALSO,
  RECADO_DO_PDF_GRANDE,
  RECADO_DO_TIPO,
  TETO_DA_FOTO,
  TETO_DO_PDF,
  motivoDaNotaRecusada,
} from './nota-do-caixa';

/**
 * A nota do fechamento de caixa entra como foto ou como PDF.
 *
 * O PDF é a nota que chega pronta — por e-mail, baixada do portal — e antes
 * só entrava fotografando a tela. A foto continua entrando como entrava.
 */
const pdf = (conteudo: string | Buffer = '%PDF-1.7\n1 0 obj\n') =>
  'data:application/pdf;base64,' +
  (Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo)).toString('base64');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';

async function errosDe<T extends object>(
  classe: new () => T,
  corpo: Record<string, unknown>,
): Promise<string[]> {
  const erros = await validate(plainToInstance(classe, corpo), {
    whitelist: true,
  });
  return erros.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('nota do fechamento de caixa', () => {
  describe('AnexarNotaDto (a nota de um lançamento do caixa)', () => {
    it('aceita a foto, como sempre aceitou', async () => {
      expect(await errosDe(AnexarNotaDto, { notaFoto: PNG })).toEqual([]);
      expect(await errosDe(AnexarNotaDto, { notaFoto: JPEG })).toEqual([]);
    });

    it('aceita o PDF', async () => {
      expect(await errosDe(AnexarNotaDto, { notaFoto: pdf() })).toEqual([]);
    });

    it('recusa o que não é foto nem PDF, dizendo o que entra', async () => {
      for (const notaFoto of [
        'data:text/html;base64,PGgxPm9pPC9oMT4=',
        'data:application/zip;base64,UEsDBA==',
        'data:image/gif;base64,R0lGODlh',
        'não é data URL',
      ]) {
        expect(await errosDe(AnexarNotaDto, { notaFoto })).toEqual([
          RECADO_DO_TIPO,
        ]);
      }
    });

    it('recusa o ".pdf" que por dentro não é PDF', async () => {
      const zipChamadoDePdf = pdf(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]));
      expect(await errosDe(AnexarNotaDto, { notaFoto: zipChamadoDePdf })).toEqual([
        RECADO_DO_PDF_FALSO,
      ]);
    });

    it('aceita o PDF com lixo antes da assinatura, que todo leitor abre', async () => {
      const comPrefixo = pdf(Buffer.concat([Buffer.alloc(200, 0x20), Buffer.from('%PDF-1.4\n')]));
      expect(await errosDe(AnexarNotaDto, { notaFoto: comPrefixo })).toEqual([]);
    });

    it('a foto continua com o teto dela', async () => {
      const grande = PNG + 'A'.repeat(TETO_DA_FOTO);
      expect(await errosDe(AnexarNotaDto, { notaFoto: grande })).toEqual([
        RECADO_DA_FOTO,
      ]);
    });

    it('o PDF tem teto maior que a foto, porque a tela não o reduz', async () => {
      // Passa do teto da foto, e cabe no do PDF.
      const medio = pdf(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5 * 1024 * 1024)]));
      expect(medio.length).toBeGreaterThan(TETO_DA_FOTO);
      expect(await errosDe(AnexarNotaDto, { notaFoto: medio })).toEqual([]);
    });

    it('recusa o PDF acima do teto, dizendo o que fazer', async () => {
      const enorme = pdf(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(9 * 1024 * 1024)]));
      expect(enorme.length).toBeGreaterThan(TETO_DO_PDF);
      expect(await errosDe(AnexarNotaDto, { notaFoto: enorme })).toEqual([
        RECADO_DO_PDF_GRANDE,
      ]);
    });
  });

  describe('NotaDto (a nota de um acerto já lançado)', () => {
    it('aceita foto e PDF', async () => {
      expect(await errosDe(NotaDto, { notaFoto: JPEG })).toEqual([]);
      expect(await errosDe(NotaDto, { notaFoto: pdf() })).toEqual([]);
    });

    it('recusa o tipo errado', async () => {
      expect(
        await errosDe(NotaDto, { notaFoto: 'data:text/plain;base64,b2k=' }),
      ).toEqual([RECADO_DO_TIPO]);
    });
  });

  describe('MovimentoDaRuaDto (as notas do acerto da rua)', () => {
    const acerto = (notasFoto: unknown) => ({ tipo: 'NOTA', valor: 50, notasFoto });

    it('aceita foto e PDF misturados', async () => {
      expect(await errosDe(MovimentoDaRuaDto, acerto([PNG, pdf(), JPEG]))).toEqual([]);
    });

    it('diz o motivo da nota recusada, e não um genérico', async () => {
      const falso = pdf('isto não é um pdf');
      expect(await errosDe(MovimentoDaRuaDto, acerto([PNG, falso]))).toEqual([
        RECADO_DO_PDF_FALSO,
      ]);
    });

    it('recusa o tipo errado no meio das outras', async () => {
      expect(
        await errosDe(
          MovimentoDaRuaDto,
          acerto([pdf(), 'data:application/msword;base64,0M8R4A==']),
        ),
      ).toEqual([RECADO_DO_TIPO]);
    });
  });

  describe('motivoDaNotaRecusada', () => {
    it('não aceita o que nem texto é', () => {
      expect(motivoDaNotaRecusada(null)).toBe(RECADO_DO_TIPO);
      expect(motivoDaNotaRecusada(42)).toBe(RECADO_DO_TIPO);
    });

    it('aceita webp e jpg, os outros formatos que a tela pode mandar', () => {
      expect(motivoDaNotaRecusada('data:image/webp;base64,UklGRg==')).toBeNull();
      expect(motivoDaNotaRecusada('data:image/jpg;base64,/9j/')).toBeNull();
    });
  });
});
