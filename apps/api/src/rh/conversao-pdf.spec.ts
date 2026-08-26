import { extensaoDe, nomeComoPdf, podeVirarPdf } from './conversao-pdf.service';
import { DocumentosRhService } from './documentos.service';
import type { GuardarDocumentoDto } from './dto/documento.dto';

/**
 * Guardar o Word já convertido em PDF é escolha de quem sobe o arquivo. O que
 * este arquivo protege é o que acontece quando a escolha não pode ser cumprida:
 *
 *  - conversão que falha **não** derruba o upload — o papel entra como veio,
 *    com um aviso dizendo por quê. O prazo do edital não espera o servidor;
 *  - o pedido só vale para o que o LibreOffice sabe abrir: PDF e foto passam
 *    direto, sem aviso, porque não há o que converter;
 *  - sem a caixa marcada, o conversor não é nem chamado;
 *  - PDF que estoura o teto de tamanho volta ao original, em vez de o
 *    documento ser recusado por causa de uma conversão que ninguém exigiu.
 */

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Um .docx de mentira: o serviço não olha o conteúdo, quem olha é o binário. */
function dataUrl(tipo = DOCX, bytes = 2048): string {
  return `data:${tipo};base64,${Buffer.alloc(bytes, 7).toString('base64')}`;
}

function montarServico(conversao: {
  paraPdf?: jest.Mock;
}) {
  const criados: Record<string, unknown>[] = [];
  const prisma = {
    pastaRh: { findUnique: jest.fn(async () => ({ id: 'pasta-1' })) },
    documentoRh: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        criados.push(data);
        return {
          ...data,
          id: 'doc-1',
          emitidoEm: null,
          valeAte: null,
        };
      }),
    },
  };

  const servico = new DocumentosRhService(
    prisma as never,
    { paraPdf: jest.fn(), ...conversao } as never,
  );

  return { servico, criados, prisma };
}

function dto(extra: Partial<GuardarDocumentoDto> = {}): GuardarDocumentoDto {
  return {
    pastaId: 'pasta-1',
    titulo: 'Proposta comercial',
    tipo: 'Proposta',
    arquivoNome: 'Proposta comercial.docx',
    arquivo: dataUrl(),
    ...extra,
  } as GuardarDocumentoDto;
}

describe('guardar com conversão para PDF', () => {
  it('guarda o PDF quando a conversão dá certo', async () => {
    const pdf = Buffer.alloc(5000, 1);
    const { servico, criados } = montarServico({
      paraPdf: jest.fn(async () => ({ convertido: true, pdf })),
    });

    const doc = await servico.guardar(dto({ converterParaPdf: true }));

    expect(criados[0].arquivoTipo).toBe('application/pdf');
    expect(criados[0].arquivoNome).toBe('Proposta comercial.pdf');
    expect(criados[0].arquivoTamanho).toBe(5000);
    expect(doc.avisoDaConversao).toBeUndefined();
  });

  it('guarda o original, com aviso, quando a conversão falha', async () => {
    const { servico, criados } = montarServico({
      paraPdf: jest.fn(async () => ({
        convertido: false,
        motivo: 'o LibreOffice não está instalado no servidor',
      })),
    });

    const doc = await servico.guardar(dto({ converterParaPdf: true }));

    expect(criados[0].arquivoTipo).toBe(DOCX);
    expect(criados[0].arquivoNome).toBe('Proposta comercial.docx');
    expect(doc.avisoDaConversao).toContain('não está instalado');
    // O documento entrou: é isso que não pode se perder por causa do conversor.
    expect(criados).toHaveLength(1);
  });

  it('guarda o original quando o PDF passaria do teto de tamanho', async () => {
    const { servico, criados } = montarServico({
      paraPdf: jest.fn(async () => ({
        convertido: true,
        pdf: Buffer.alloc(16 * 1024 * 1024, 1),
      })),
    });

    const doc = await servico.guardar(dto({ converterParaPdf: true }));

    expect(criados[0].arquivoTipo).toBe(DOCX);
    expect(doc.avisoDaConversao).toContain('acima do limite');
  });

  it('não chama o conversor sem a caixa marcada', async () => {
    const paraPdf = jest.fn();
    const { servico, criados } = montarServico({ paraPdf });

    const doc = await servico.guardar(dto());

    expect(paraPdf).not.toHaveBeenCalled();
    expect(criados[0].arquivoTipo).toBe(DOCX);
    expect(doc.avisoDaConversao).toBeUndefined();
  });

  it('ignora o pedido em PDF e em foto, sem avisar do que ninguém pediu', async () => {
    const paraPdf = jest.fn();
    const { servico } = montarServico({ paraPdf });

    const doc = await servico.guardar(
      dto({
        converterParaPdf: true,
        arquivoNome: 'certidao.pdf',
        arquivo: dataUrl('application/pdf'),
      }),
    );

    expect(paraPdf).not.toHaveBeenCalled();
    expect(doc.avisoDaConversao).toBeUndefined();
  });
});

describe('podeVirarPdf', () => {
  it('aceita Word e planilha, e recusa o que não tem o que converter', () => {
    expect(podeVirarPdf(DOCX)).toBe(true);
    expect(podeVirarPdf('application/msword')).toBe(true);
    expect(
      podeVirarPdf(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(true);
    expect(podeVirarPdf('application/pdf')).toBe(false);
    expect(podeVirarPdf('image/jpeg')).toBe(false);
    expect(podeVirarPdf('text/plain')).toBe(false);
  });
});

describe('extensaoDe', () => {
  it('lê a extensão do nome', () => {
    expect(extensaoDe('Proposta.docx')).toBe('.docx');
    expect(extensaoDe('Planilha de preços 2026.XLSX')).toBe('.xlsx');
  });

  it('recusa o que não serve para montar um caminho de arquivo', () => {
    expect(extensaoDe('sem extensão')).toBeNull();
    expect(extensaoDe('termina com ponto.')).toBeNull();
    expect(extensaoDe('.oculto')).toBeNull();
    // O nome do arquivo vem do navegador: ele não pode virar caminho.
    expect(extensaoDe('nota.do/../../etc/passwd')).toBeNull();
  });
});

describe('nomeComoPdf', () => {
  it('troca a extensão, e não o nome', () => {
    expect(nomeComoPdf('Proposta comercial.docx')).toBe(
      'Proposta comercial.pdf',
    );
    expect(nomeComoPdf('Balanço 2025.v2.xlsx')).toBe('Balanço 2025.v2.pdf');
  });

  it('acrescenta a extensão quando não havia nenhuma', () => {
    expect(nomeComoPdf('documento')).toBe('documento.pdf');
  });
});
