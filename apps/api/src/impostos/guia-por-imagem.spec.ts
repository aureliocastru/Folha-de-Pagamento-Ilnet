import {
  linhaDigitavelDoCodigoDeBarras,
  MARCA_DO_OCR,
  pixConferido,
  textoDaImagem,
  valorDoCodigoDeBarras,
} from './guia-por-imagem';
import { conferir, lerGuia } from './guias.parse';
import { ImpostosService } from './impostos.service';

/**
 * A guia "impressa em PDF", lida da imagem. O que este arquivo protege:
 *
 *  - código de pagamento nunca sai do OCR: linha digitável e PIX reconhecidos
 *    na imagem são jogados fora, mesmo quando têm cara de válidos;
 *  - o código que vale é o do código de barras / QR Code, e só com os dígitos
 *    verificadores (ou o CRC do PIX) fechando;
 *  - o texto do OCR, com o lixo dele, ainda chega ao leitor das guias com
 *    competência, vencimento, total e itens;
 *  - o total lido que discorda do valor do código de barras é avisado.
 *
 * Os textos abaixo copiam o jeito do OCR das guias de verdade — linhas de
 * ponta a ponta, quadros vizinhos na mesma linha, travessão e colchete
 * sobrando —, com empresa, CNPJ e números inventados.
 */

// Códigos inventados, com os dígitos e o CRC certos.
const BARRAS = '85850000012345600011122233344455566677788899';
const LINHA = '85850000012 6 34560001112 6 22333444555 0 66677788899 9';
const PIX =
  '00020126330014br.gov.bcb.pix0111000000000005204000053039865802BR5913EMPRESA TESTE' +
  '6008BRASILIA62070503***63041061';

const OCR_DARF = [
  'Documento de Arrecadação',
  '"=',
  'Receita Federal de Receitas Federais',
  'CNPJ Razão Social',
  '11.222.333/0001-44) ([EMPRESA EXEMPLO DE TELECOMUNICACOES LTDA',
  'Período de Apuração Data de Vencimento Número do Documento Pagar este documento até',
  'agosto/2026 18/09/2026 07.00.12345.6789012-3',
  ': 18/09/2026',
  'Nº Recibo Declaração: 50000000000000 Valor Total do Documento',
  '1.234,56',
  'Composição do Documento de Arrecadação',
  'Código Denominação Principal Multa Juros Total',
  '1082 —CONTR PREV DESCONTA SEGURADO -EMPREGADO/AVULSO 1.100,00 1.100,00',
  '01 CP SEGURADOS - EMPREGADOS/AVULSO',
  'PA:08/2026 Vencimento:18/09/2026',
  '1099 CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL 134,56 134,56',
  'PA:08/2026 Vencimento:18/09/2026',
  'Totais 1.234,56 1.234,56',
  'SENDA (Versão:1.5.10) Página: 1/1 10/09/2026 15:08:55',
  // A linha digitável como o OCR a viu: um "O" no lugar de um zero...
  '85850000012 6 3456O001112 6 22333444555 0 66677788899 9 AUTENTICAÇÃO MECÂNICA',
  'Documento de Arrecadação de Receitas Federais Pague com o PIX',
  // ...e, no canhoto, com cara de válida mas o último dígito trocado.
  '85850000012 6 34560001112 6 22333444555 0 66677788899 8 CNPJ: 11.222.333/0001-44 E: SETE',
  'Número: — 07.00.12345.6789012-3 Meia Estao:',
  '| Pagar até: 18/09/2026 ACE',
  'Valor: 1.234,56 Ml GERAE:',
].join('\n');

const OCR_FGTS = [
  // O título ao lado do logotipo se perdeu: sobrou o "Digital".
  'Digital :',
  'Pagar este documento até',
  'CPF/CNPJ do Empregador Nome/Razão Social do Empregador 18/09/2026',
  '11.222.333 | | EMPRESA EXEMPLO LTDA As DE» "”',
  'às 21:59:59 (Brasília)',
  'Valor a recolher',
  'Núm. de Pág. Identificador Tag 2 500 00',
  "1 O12345678901/2345-6]| 10/09/2026 15:10 ' !",
  'Composição do Documento',
  'Informações de recolhimentos do FGTS',
  'Competência Trabalhadores FGTS Mensal FGTS Rescisório Compensatória Encargos FGTS Total',
  '08/2026 10 2.000,00 0,00 0,00 0,00 2.000,00',
  'Total FGTS: 2.000,00 0,00 0,00 0,00 2.000,00',
  'Informações de recolhimentos do Consignado',
  'Competência Consignado Encargos Consignado Total',
  '08/2026 500,00 0,00 500,00',
  'Total Consignado: 500,00 0,00 500,00',
  'Total da Guia: 2.500,00',
  'Data de geração da Guia: 10/09/2076 às 15:10:20 - Página 1/1',
  'PIX Copia e Cola:',
  // O PIX como o OCR o viu: "l" no lugar de "1", CRC no fim como se nada fosse.
  '00020126330014br.gov.bcb.pix0lll000000000005204000053039865802BR5913EMPRESA TESTE6008BRASILIA62070503***63041061',
].join('\n');

/**
 * A guia do FGTS "atualizada": gerada depois do dia, com os encargos do atraso
 * numa coluna própria — e o total da guia é o FGTS do mês mais eles.
 */
const OCR_FGTS_COM_ENCARGOS = [
  'Digital :',
  'Pagar este documento até',
  'CPF/CNPJ do Empregador Nome/Razão Social do Empregador 21/09/2026',
  '11.222.333 || EMPRESA EXEMPLO LTDA 5 NSODO Brasílte)',
  'Valor a recolher',
  'Núm. de Pág. Identificador Tag 2 100 00',
  '1 O12345678901/2345-6) | 21/09/2026 09:15 ! !',
  'Composição do Documento',
  'Informações de recolhimentos do FGTS',
  'Competência Trabalhadores FGTS Mensal FGTS Rescisório Compensatória Encargos FGTS Total',
  '08/2026 10 2.000,00 0,00 0,00 100,00 2.100,00',
  'Total FGTS: 2.000,00 0,00 0,00 100,00 2.100,00',
  'Informações de recolhimentos do Consignado',
  'Não há informações de recolhimentos do Consignado',
  'Total da Guia: 2.100,00',
  'Data de geração da Guia: 21/09/2026 às 09:15:35 - Página 1/1',
].join('\n');

/**
 * A guia do consignado, que o FGTS Digital manda à parte: o quadro do FGTS
 * vazio, e a linha da composição sem a coluna de trabalhadores. A tag saiu
 * embaralhada ("112/2333"), como sai de verdade.
 */
const OCR_CONSIGNADO = [
  '( FGT S GFD - Guia do FGTS Digital',
  'Digital :',
  'Pagar este documento até',
  'CPF/CNPJ do Empregador Nome/Razão Social do Empregador 21/09/2026',
  '11.222.333 || EMPRESA EXEMPLO LTDA 5 NSODO Brasílte)',
  'Valor a recolher',
  'Núm. de Pág. Identificador Tag 5 e 1 00',
  "1 OB52345678901/2345-0 | | 112/2333 08/2026 MENSAL '",
  'Composição do Documento',
  'Informações de recolhimentos do FGTS',
  'Não há informações de recolhimentos do FGTS',
  'Informações de recolhimentos do Consignado',
  'Competência Consignado Encargos Consignado Total',
  '08/2026 500,00 10,00 510,00',
  'Total Consignado: 500,00 10,00 510,00',
  'Total da Guia: 510,00',
  'Data de geração da Guia: 21/09/2026 às 09:15:50 - Página 1/1',
].join('\n');

describe('linhaDigitavelDoCodigoDeBarras', () => {
  it('monta os quatro blocos com o dígito de cada um', () => {
    expect(linhaDigitavelDoCodigoDeBarras(BARRAS)).toBe(LINHA);
  });

  it('recusa barra mal lida: o dígito geral não fecha', () => {
    const trocada = BARRAS.slice(0, 20) + '9' + BARRAS.slice(21);
    expect(linhaDigitavelDoCodigoDeBarras(trocada)).toBeNull();
  });

  it('recusa o que não é código de arrecadação', () => {
    expect(linhaDigitavelDoCodigoDeBarras('2' + BARRAS.slice(1))).toBeNull();
    expect(linhaDigitavelDoCodigoDeBarras(BARRAS.slice(1))).toBeNull();
  });

  it('o valor em reais sai do código', () => {
    expect(valorDoCodigoDeBarras(LINHA)).toBe(1234.56);
  });
});

describe('pixConferido', () => {
  it('aceita o copia e cola com o CRC certo, e recusa com uma letra trocada', () => {
    expect(pixConferido(PIX)).toBe(true);
    expect(pixConferido(PIX.replace('EMPRESA', 'EMPRESO'))).toBe(false);
  });
});

describe('textoDaImagem', () => {
  it('joga fora a linha digitável e o PIX do OCR, e fica com os conferidos', () => {
    const texto = textoDaImagem(OCR_DARF, [BARRAS, PIX]);
    expect(texto.split('\n')[0]).toBe(MARCA_DO_OCR);
    expect(texto).not.toContain('66677788899 8');
    expect(texto).not.toContain('3456O001112');
    expect(texto).toContain(`Código de barras lido da imagem: ${LINHA}`);
    expect(texto).toContain(PIX);
  });

  it('código que não confere não entra', () => {
    const errado = BARRAS.slice(0, 20) + '9' + BARRAS.slice(21);
    const texto = textoDaImagem(OCR_DARF, [errado, PIX.replace('EMPRESA', 'EMPRESO')]);
    expect(lerGuia(texto).pagamento).toBeNull();
  });
});

describe('o DARF lido da imagem', () => {
  it('sai com competência, vencimento, total, itens e a linha digitável da barra', () => {
    const guia = lerGuia(textoDaImagem(OCR_DARF, [BARRAS]));
    expect(guia).toMatchObject({
      tipo: 'DARF_INSS',
      competencia: '2026-08',
      vencimento: '2026-09-18',
      valorTotal: 1234.56,
      numeroDocumento: '07.00.12345.6789012-3',
      cnpj: '11.222.333/0001-44',
      razaoSocial: 'EMPRESA EXEMPLO DE TELECOMUNICACOES LTDA',
      pagamento: { forma: 'BOLETO', codigoBarras: LINHA.replace(/\s/g, '') },
    });
    expect(guia.itens.map((i) => [i.codigo, i.valor])).toEqual([
      ['1082', 1100],
      ['1099', 134.56],
    ]);
    // O travessão do OCR não gruda na denominação.
    expect(guia.itens[0].denominacao).toMatch(/^CONTR PREV/);
  });

  it('as aspas de um cisco no papel não grudam na denominação', () => {
    const texto = OCR_DARF.replace('1099 CP DESCONTADA', '1099 “CP DESCONTADA');
    expect(lerGuia(textoDaImagem(texto, [BARRAS])).itens[1].denominacao).toMatch(/^CP DESC/);
  });

  /*
   * O DARF atualizado: o vencimento original (18/09) já passou, e o documento
   * vale até 21/09. O OCR leu o rodapé com o ano trocado — "2006" —, e o quadro
   * do topo tem a data certa, na linha de baixo da do vencimento original.
   */
  const atualizado = OCR_DARF.replace(': 18/09/2026', ': 21/09/2026');

  it('data antes da apuração é leitura errada: vale a do quadro do topo', () => {
    const texto = atualizado.replace('Pagar até: 18/09/2026', 'Pagar até: 21/09/2006');
    expect(lerGuia(textoDaImagem(texto, [BARRAS])).vencimento).toBe('2026-09-21');
  });

  it('do quadro do topo vale o "pagar até", não o vencimento original', () => {
    const texto = atualizado.replace('| Pagar até: 18/09/2026 ACE', '');
    expect(lerGuia(textoDaImagem(texto, [BARRAS])).vencimento).toBe('2026-09-21');
  });

  it('sem nenhuma data possível, recusa em vez de gravar a errada', () => {
    const texto = OCR_DARF.replace(/18\/09\/2026/g, '18/09/2006');
    expect(() => lerGuia(textoDaImagem(texto, [BARRAS]))).toThrow(
      /Li o vencimento como 18\/09\/2006, antes do fim da apuração \(08\/2026\)/,
    );
  });
});

describe('o FGTS lido da imagem', () => {
  it('é reconhecido sem o título, e a competência sai da composição', () => {
    const guia = lerGuia(textoDaImagem(OCR_FGTS, [PIX]));
    expect(guia).toMatchObject({
      tipo: 'FGTS',
      competencia: '2026-08',
      vencimento: '2026-09-18',
      valorTotal: 2500,
      trabalhadores: 10,
      pagamento: { forma: 'PIX', copiaECola: PIX },
    });
    expect(guia.itens.map((i) => [i.classe, i.valor])).toEqual([
      ['FOLHA_PATRONAL', 2000],
      ['FOLHA_RETIDO', 500],
    ]);
  });

  it('sem o QR Code decodificado, fica sem PIX — e não com o do OCR', () => {
    expect(lerGuia(textoDaImagem(OCR_FGTS, [])).pagamento).toBeNull();
  });

  it('os encargos do atraso entram como item, e a soma fecha com o total', () => {
    const guia = lerGuia(textoDaImagem(OCR_FGTS_COM_ENCARGOS, [PIX]));
    expect(guia).toMatchObject({ competencia: '2026-08', valorTotal: 2100, trabalhadores: 10 });
    expect(guia.itens.map((i) => [i.denominacao, i.classe, i.valor])).toEqual([
      ['FGTS mensal', 'FOLHA_PATRONAL', 2000],
      ['Encargos do FGTS (atraso)', 'FOLHA_PATRONAL', 100],
    ]);
    expect(conferir(guia)).toBeNull();
  });

  /*
   * A parcela do empréstimo é do trabalhador, só repassada; os encargos são a
   * empresa pagando pelo próprio atraso — ninguém descontou isso de ninguém.
   */
  it('a guia só do consignado: competência sem a coluna de trabalhadores', () => {
    const guia = lerGuia(textoDaImagem(OCR_CONSIGNADO, [PIX]));
    expect(guia).toMatchObject({
      tipo: 'FGTS',
      competencia: '2026-08',
      vencimento: '2026-09-21',
      valorTotal: 510,
      trabalhadores: null,
    });
    expect(guia.itens.map((i) => [i.denominacao, i.classe, i.valor])).toEqual([
      ['Consignado retido do trabalhador', 'FOLHA_RETIDO', 500],
      ['Encargos do consignado (atraso)', 'FOLHA_PATRONAL', 10],
    ]);
    expect(conferir(guia)).toBeNull();
  });
});

describe('ImpostosService.lerDaImagem', () => {
  function montar() {
    const prisma = { guia: { findFirst: jest.fn().mockResolvedValue(null) } };
    return new ImpostosService(prisma as never, {} as never, {} as never);
  }

  it('marca a leitura como da imagem', async () => {
    const r = await montar().lerDaImagem({
      texto: OCR_DARF,
      codigos: [BARRAS],
      arquivoNome: 'darf.pdf',
    });
    expect(r.lidoDaImagem).toBe(true);
    expect(r.divergencia).toBeNull();
    expect(r.textoOriginal.startsWith(MARCA_DO_OCR)).toBe(true);
  });

  it('avisa quando o total lido não bate com o valor do código de barras', async () => {
    const r = await montar().lerDaImagem({
      // O OCR leu 1.284,56 no lugar de 1.234,56 — nos três lugares do total.
      texto: OCR_DARF.replace(/1\.234,56/g, '1.284,56'),
      codigos: [BARRAS],
      arquivoNome: 'darf.pdf',
    });
    expect(r.divergencia).toMatch(/não bate com o valor do código de barras \(1234\.56\)/);
  });

  /*
   * Sem o número do documento (o OCR não o lê), a repetida se reconhece pelo
   * valor: tipo e mês não bastam, porque a guia do consignado é do mesmo tipo e
   * do mesmo mês que a do FGTS.
   */
  it('sem o número da guia, procura a repetida pelo valor', async () => {
    const prisma = { guia: { findFirst: jest.fn().mockResolvedValue(null) } };
    const servico = new ImpostosService(prisma as never, {} as never, {} as never);
    await servico.lerDaImagem({ texto: OCR_CONSIGNADO, codigos: [PIX], arquivoNome: 'c.pdf' });
    expect(prisma.guia.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tipo: 'FGTS', competencia: '2026-08', valorTotal: 510 },
      }),
    );
  });
});
