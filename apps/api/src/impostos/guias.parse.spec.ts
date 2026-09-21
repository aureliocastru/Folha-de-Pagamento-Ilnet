import { conferir, GuiaIlegivelError, lerGuia, parseValor } from './guias.parse';

/**
 * Os textos abaixo são cópias fiéis do que o leitor de PDF devolve para as
 * guias de verdade — mesma ordem de linhas, mesmas tabulações, mesmas colunas
 * embaralhadas. O que se testa aqui é o layout, não o dinheiro.
 *
 * **Nada de real entra neste arquivo**: CNPJ, razão social, endereço, números
 * de documento, identificadores, linhas digitáveis e valores são todos
 * inventados. O repositório é público, e linha digitável é instrumento de
 * pagamento — vale o mesmo cuidado de não colar uma aqui que de não colar uma
 * senha.
 */

const DARF_INSS = `Documento de Arrecadação
de Receitas Federais
11.222.333/0001-44 EMPRESA EXEMPLO SERVICOS LTDA
Período de Apuração Data de Vencimento Número do Documento
07.16.11111.2222222-3 Pagar este documento até
20/08/2026\tObservações
Nº Recibo Declaração: 50000000000001 Valor Total do Documento
1.234,56
CNPJ Razão Social
Julho/2026 20/08/2026
Código Principal\tDenominação Total\tMulta Juros
Composição do Documento de Arrecadação
1082 CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO 1.000,00 1.000,00
01 CP SEGURADOS - EMPREGADOS/AVULSO
PA:07/2026 Vencimento:20/08/2026
1099 CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL 234,56 234,56
01 CP SEGURADOS - CONTRIBUINTES INDIVIDUAIS - 11%
PA:07/2026 Vencimento:20/08/2026
Totais 1.234,56 1.234,56
SENDA (Versão:5.2.10) 07/08/2026 14:50:43\t1 1\tPágina: /
85830000012 3 34560000000 0 00000000000 0 00011122233 4 AUTENTICAÇÃO MECÂNICA
Documento de Arrecadação de Receitas Federais
85830000012 3 34560000000 0 00000000000 0 11.222.333/0001-44
Número: 07.16.11111.2222222-3
Pagar até: 20/08/2026
Valor: 1.234,56
00011122233 4 CNPJ:
Pague com o PIX
`;

const DAS_SIMPLES = `Documento de Arrecadação
do Simples Nacional
11.222.333/0001-44 EMPRESA EXEMPLO SERVICOS LTDA
Período de Apuração Data de Vencimento Número do Documento
07.20.11111.3333333-2 Pagar este documento até
20/07/2026\tObservações
Valor Total do Documento
6.500,00
CNPJ Razão Social
Junho/2026 20/07/2026
Código Principal\tDenominação Total\tMulta Juros
Composição do Documento de Arrecadação
1001 IRPJ - SIMPLES NACIONAL 100,00 100,00
06/2026
1002 CSLL - SIMPLES NACIONAL 200,00 200,00
06/2026
1004 COFINS - SIMPLES NACIONAL 300,00 300,00
06/2026
1005 PIS - SIMPLES NACIONAL 400,00 400,00
06/2026
1006 INSS - SIMPLES NACIONAL 5.000,00 5.000,00
06/2026
1007 ICMS - SIMPLES NACIONAL 500,00 500,00
MA - 06/2026
Totais 6.500,00 6.500,00
SENDA (Versão:5.2.9) 16/07/2026 11:55:51\t1 1\tPágina: /
85870000065 2 00000000000 5 00000000000 7 00011133322 0 AUTENTICAÇÃO MECÂNICA
Documento de Arrecadação do Simples Nacional
85870000065 2 00000000000 5 00000000000 7 11.222.333/0001-44
Número: 07.20.11111.3333333-2
Pagar até: 20/07/2026
Valor: 6.500,00
00011133322 0 CNPJ:
Pague com o PIX
`;

const FGTS = `CPF/CNPJ do Empregador
11.222.333
Nome/Razão Social do Empregador
EMPRESA EXEMPLO SERVICOS LTDA
Núm. de Pág.
1
Identificador
0126080000111222-3
Tag
11222333 07/2026 MENSAL
Pagar este documento até
20/08/2026
Valor a recolher
2.500,00
GFD - Guia do FGTS Digital
às 21:59:59 (Brasília)
Composição do Documento
Competência
Quantidade
Trabalhadores FGTS Mensal FGTS Rescisório
Indenização
Compensatória Encargos FGTS Total
2.000,00\t0,00\t2.000,00 0,00 0,00\t07/2026 12
Total FGTS: 2.000,00\t0,00\t2.000,00 0,00 0,00
Informações de recolhimentos do FGTS
Competência Consignado Total\tEncargos Consignado
500,00\t500,00\t07/2026 0,00
500,00\tTotal Consignado: 500,00\t0,00
Total da Guia: 2.500,00
Informações de recolhimentos do Consignado
Observações
Data de geração da Guia: 07/08/2026 às 14:48:47 - Página 1/1
O detalhamento da guia pode ser consultado através do endereço https://fgtsdigital.sistema.gov.br
00020101021226900014br.gov.bcb.pix2568pix-qrcode.caixa.gov.br/api/v2/cobv/00000000000000000000000000000000520400005303986580\
2BR5923CAIXA ECONOMICA FEDERAL6008Brasilia62070503***63040000
PIX Copia e Cola:
pix-qrcode.caixa.gov.br/api/v2/cobv/00000000000000000000000000000000
Payload Location:
`;

/**
 * DARE do estado. Repare na "Relação de Pagamentos": o gerador do documento
 * cospe as colunas fora de ordem e coladas ("0,00100,0006/20264001"), e é por
 * isso que o leitor tira dali só o período e o código da receita.
 */
const DARE = `Nosso Número
111222333
Data de Emissão
15/07/2026
ESTADO DO MARANHÃO
SECRETARIA DE ESTADO DA FAZENDA
DOCUMENTO DE ARRECADAÇÃO DE RECEITAS ESTADUAIS - DARE
RELAÇÃO DE PAGAMENTOS
Nome/ Razão Social
Endereço Inscrição Estadual/ RENAVAM
Válido Até
EMPRESA EXEMPLO SERVICOS LTDA
12.345678-9
20/07/2026
AVE EXEMPLO 100 - CENTRO
TelefoneCPF/CNPJ
11.222.333/0001-44
CEP
65000-000 CIDADE EXEMPLO - MA
Município / UF
Nº DOC. ORIGEM REFERÊNCIA/ PARCELA VENCIMENTO VALOR DOS JUROS VALOR DA MULTA VALOR TOTALVALOR PRINCIPALCÓDIGO DA RECEITA
0,00100,0006/20264001 0,00 100,00*20/07/2026 101
0,00400,0006/20264002 0,00 400,00*20/07/2026 101
Quantidade de Itens Total Principal Valor Total
DARE/Modelo aprovado pela Portaria 030/2013 - SEFAZ.
INFORMAÇÕES COMPLEMENTARES:
Valor Principal
500,00
0,00
Juros
0,00
Multa
500,00
Total a Recolher
Linha digitável: 85650000005 2 00000010200 9 00000000000 0 00111222333 5
500,002 500,00
Nome/ Razão Social
Inscrição Estadual/ RENAVAM
EMPRESA EXEMPLO SERVICOS LTDA
12.345678-9
Total Juros
0,00
Total Multa
0,00
CPF/CNPJ
11.222.333/0001-44
Telefone Válido Até
20/07/2026
TOTAIS
(*) Valor informado pelo Contribuinte.
`;

/**
 * DARE da parcela de um parcelamento na SEFAZ. O mesmo documento do ICMS, com
 * duas diferenças que mudam a leitura: na relação vem o número da parcela
 * ("18", colado nos valores) onde o ICMS traz o mês, e a data da relação é a
 * da parcela no calendário do acordo — o documento vale até a "Data
 * Vencimento".
 */
const PARCELAMENTO = `Nosso Número
111222333
Data de Emissão
16/09/2026
ESTADO DO MARANHÃO
SECRETARIA DE ESTADO DA FAZENDA
DOCUMENTO DE ARRECADAÇÃO DE RECEITAS ESTADUAIS - DARE
RELAÇÃO DE PAGAMENTOS
Nome/ Razão Social
Endereço Inscrição Estadual/ RENAVAM
Válido Até:
EMPRESA EXEMPLO SERVICOS LTDA
12.345678-9
30/09/2026
AVE EXEMPLO 100 - CENTRO
Telefone
(0)
CPF/CNPJ
11.222.333/0001-44
CEP
CIDADE EXEMPLO - MA
Município / UF
Nº DOC. ORIGEM REFERÊNCIA/ VENCIMENTO VALOR DOS JUROS VALOR DA MULTA VALOR TOTALVALOR PRINCIPALCÓDIGO DA
100,001.000,0018300000000001 200,00 1.300,0030/11/2026 104
Quantidade de Itens Total Principal Valor Total
DARE/Modelo aprovado pela Portaria 030/2013 - SEFAZ.
Esta quitação só terá validade após recebimento do pagamento
INFORMAÇÕES COMPLEMENTARES:
Valor Principal
1.000,00
100,00
Juros
200,00
Multa
1.300,00
Total a Recolher
Linha digitável: 85660000013 0 00000010214 1 00000000000 0 00111222333 4
1.300,001 1.000,00
Total Juros
100,00
Total Multa
200,00
Data Vencimento
30/09/2026
TOTAIS
Aplicação: Parcelamento/Conta Fiscal/SEFAZ.net
`;

describe('DARF previdenciário', () => {
  const guia = lerGuia(DARF_INSS);

  it('lê competência, vencimento e total', () => {
    expect(guia).toMatchObject({
      tipo: 'DARF_INSS',
      competencia: '2026-07',
      vencimento: '2026-08-20',
      valorTotal: 1234.56,
      numeroDocumento: '07.16.11111.2222222-3',
      cnpj: '11.222.333/0001-44',
      razaoSocial: 'EMPRESA EXEMPLO SERVICOS LTDA',
    });
  });

  /**
   * O que a empresa desconta do trabalhador e repassa não é custo dela. Marcar
   * como patronal aqui inflaria o "quanto custa meu funcionário".
   */
  it('trata os dois códigos como retido do trabalhador', () => {
    expect(guia.itens).toEqual([
      {
        codigo: '1082',
        denominacao: 'CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO',
        valor: 1000,
        classe: 'FOLHA_RETIDO',
        classeIncerta: false,
      },
      {
        codigo: '1099',
        denominacao: 'CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL',
        valor: 234.56,
        classe: 'FOLHA_RETIDO',
        classeIncerta: false,
      },
    ]);
  });

  /** Linhas soltas do documento não podem virar item da composição. */
  it('ignora rodapé, código de barras e detalhe do item', () => {
    expect(guia.itens).toHaveLength(2);
  });

  it('a soma dos itens bate com o total impresso', () => {
    expect(conferir(guia)).toBeNull();
  });
});

describe('DAS do Simples Nacional', () => {
  const guia = lerGuia(DAS_SIMPLES);

  it('lê a competência do mês anterior ao vencimento', () => {
    expect(guia).toMatchObject({
      tipo: 'DAS_SIMPLES',
      competencia: '2026-06',
      vencimento: '2026-07-20',
      valorTotal: 6500,
    });
  });

  /**
   * O ponto do documento inteiro: dentro do DAS, só o INSS é custo de pessoal.
   * Somar o DAS todo como "imposto da folha" mais que dobra o número.
   */
  it('separa o INSS patronal do tributo sobre faturamento', () => {
    const porClasse = (classe: string) =>
      guia.itens
        .filter((i) => i.classe === classe)
        .reduce((s, i) => s + i.valor, 0);

    expect(porClasse('FOLHA_PATRONAL')).toBe(5000);
    expect(porClasse('FATURAMENTO')).toBe(1500);
    expect(guia.itens.every((i) => !i.classeIncerta)).toBe(true);
  });

  it('a soma dos itens bate com o total impresso', () => {
    expect(conferir(guia)).toBeNull();
  });
});

describe('guia do FGTS Digital', () => {
  const guia = lerGuia(FGTS);

  it('lê pelos totais rotulados, não pela posição das colunas', () => {
    expect(guia).toMatchObject({
      tipo: 'FGTS',
      competencia: '2026-07',
      vencimento: '2026-08-20',
      valorTotal: 2500,
      trabalhadores: 12,
      razaoSocial: 'EMPRESA EXEMPLO SERVICOS LTDA',
      numeroDocumento: '0126080000111222-3',
    });
  });

  /** Consignado é empréstimo do trabalhador sendo repassado — não é tributo. */
  it('separa o FGTS do consignado', () => {
    expect(guia.itens).toEqual([
      {
        codigo: null,
        denominacao: 'FGTS mensal',
        valor: 2000,
        classe: 'FOLHA_PATRONAL',
        classeIncerta: false,
      },
      {
        codigo: null,
        denominacao: 'Consignado retido do trabalhador',
        valor: 500,
        classe: 'FOLHA_RETIDO',
        classeIncerta: false,
      },
    ]);
  });

  it('a soma dos itens bate com o total da guia', () => {
    expect(conferir(guia)).toBeNull();
  });

  /*
   * A guia gerada depois do dia traz os encargos do atraso. Com as colunas
   * embaralhadas, não dá para dizer qual número é qual — mas o total da linha
   * é o maior deles, e o que passa do FGTS do mês entra como um item só.
   */
  it('com encargos, o que passa da coluna principal entra à parte', () => {
    const comEncargos = lerGuia(
      FGTS.replace(
        'Total FGTS: 2.000,00\t0,00\t2.000,00 0,00 0,00',
        'Total FGTS: 2.000,00\t0,00\t2.100,00 0,00 100,00',
      )
        .replace('500,00\tTotal Consignado: 500,00\t0,00', '510,00\tTotal Consignado: 500,00\t10,00')
        .replace('Total da Guia: 2.500,00', 'Total da Guia: 2.610,00'),
    );
    expect(comEncargos.itens.map((i) => [i.denominacao, i.classe, i.valor])).toEqual([
      ['FGTS mensal', 'FOLHA_PATRONAL', 2000],
      ['Encargos e demais valores do FGTS', 'FOLHA_PATRONAL', 100],
      ['Consignado retido do trabalhador', 'FOLHA_RETIDO', 500],
      ['Encargos do consignado (atraso)', 'FOLHA_PATRONAL', 10],
    ]);
    expect(conferir(comEncargos)).toBeNull();
  });
});

describe('DARE do ICMS', () => {
  const guia = lerGuia(DARE);

  /**
   * A apuração só existe na coluna "Referência/Parcela" da relação — e é a
   * única coisa que diz de que mês é o arquivo. Vencimento e código da receita
   * vêm do fim da mesma linha, o único par que o embaralhamento não alcança.
   */
  it('lê a apuração e o vencimento da relação de pagamentos', () => {
    expect(guia).toMatchObject({
      tipo: 'DARE_ICMS',
      competencia: '2026-06',
      vencimento: '2026-07-20',
      numeroDocumento: '111222333',
      cnpj: '11.222.333/0001-44',
      razaoSocial: 'EMPRESA EXEMPLO SERVICOS LTDA',
    });
  });

  /** Imposto de estado é tributo sobre faturamento: nada dele é custo de gente. */
  it('o ICMS não encosta no custo com pessoal', () => {
    expect(guia.itens).toEqual([
      {
        codigo: '101',
        denominacao: 'ICMS — DARE estadual',
        valor: 500,
        classe: 'FATURAMENTO',
        classeIncerta: false,
      },
    ]);
  });

  /**
   * O total sai da linha digitável, montada longe dos totais impressos: se as
   * duas contas divergirem é porque o leitor perdeu alguma coisa.
   */
  it('o total confere com a linha digitável', () => {
    expect(guia.valorTotal).toBe(500);
    expect(conferir(guia)).toBeNull();
  });

  it('juro e multa entram como item à parte', () => {
    const comJuros = lerGuia(
      DARE.replace(
        'Total Juros\n0,00\nTotal Multa\n0,00',
        'Total Juros\n12,00\nTotal Multa\n8,00',
      )
        // A linha digitável passa a cobrar 520,00 — os onze dígitos de valor
        // atravessam a fronteira entre o primeiro e o segundo bloco.
        .replace('00000010200 9', '20000010200 9'),
    );
    expect(comJuros.itens).toContainEqual({
      codigo: null,
      denominacao: 'Juros e multa',
      valor: 20,
      classe: 'FATURAMENTO',
      classeIncerta: false,
    });
    expect(comJuros.valorTotal).toBe(520);
    expect(conferir(comJuros)).toBeNull();
  });

  /** Receita estadual que o leitor não conhece: entra, mas sai marcada. */
  it('código de receita novo é lido e marcado para conferência', () => {
    const outra = lerGuia(DARE.replace(/20\/07\/2026 101/g, '20/07/2026 505'));
    expect(outra.itens[0]).toMatchObject({
      codigo: '505',
      denominacao: 'receita 505 — DARE estadual',
      classe: 'FATURAMENTO',
      classeIncerta: true,
    });
  });

  /** Sem a relação não há apuração — e guia sem mês não vai para lugar nenhum. */
  it('DARE sem relação de pagamentos não vira guia', () => {
    expect(() =>
      lerGuia(DARE.replace(/^0,00.*20\/07\/2026 101$/gm, '')),
    ).toThrow(GuiaIlegivelError);
  });
});

describe('DARE do parcelamento da SEFAZ', () => {
  const guia = lerGuia(PARCELAMENTO);

  /*
   * Apuração a parcela não tem: entra no conjunto do mês anterior ao
   * vencimento, com as guias que se pagam junto com ela.
   */
  it('vence no dia do documento e entra no conjunto do mês de antes', () => {
    expect(guia).toMatchObject({
      tipo: 'PARCELAMENTO_SEFAZ',
      competencia: '2026-08',
      // E não 30/11, a data da parcela no calendário do acordo.
      vencimento: '2026-09-30',
      valorTotal: 1300,
      numeroDocumento: '111222333',
      cnpj: '11.222.333/0001-44',
      razaoSocial: 'EMPRESA EXEMPLO SERVICOS LTDA',
    });
  });

  it('principal e juros com multa, tudo sobre faturamento', () => {
    expect(guia.itens).toEqual([
      {
        codigo: '104',
        denominacao: 'Parcelamento SEFAZ — principal',
        valor: 1000,
        classe: 'FATURAMENTO',
        classeIncerta: false,
      },
      {
        codigo: null,
        denominacao: 'Parcelamento SEFAZ — juros e multa',
        valor: 300,
        classe: 'FATURAMENTO',
        classeIncerta: false,
      },
    ]);
    expect(conferir(guia)).toBeNull();
  });

  it('leva a linha digitável, para a conta poder ser paga', () => {
    expect(guia.pagamento).toEqual({
      forma: 'BOLETO',
      codigoBarras: '856600000130000000102141000000000000001112223334',
    });
  });

  it('a parcela de janeiro fica com o conjunto de dezembro', () => {
    const janeiro = lerGuia(
      PARCELAMENTO.replace('Data Vencimento\n30/09/2026', 'Data Vencimento\n29/01/2027'),
    );
    expect(janeiro).toMatchObject({ competencia: '2026-12', vencimento: '2027-01-29' });
  });
});

describe('quando o leitor não dá conta', () => {
  it('PDF de outra coisa não vira guia', () => {
    expect(() => lerGuia('Nota fiscal de serviço\nValor: 100,00')).toThrow(
      GuiaIlegivelError,
    );
  });

  /**
   * Código de receita que ainda não existia. O lançamento não trava — mas o
   * item sai marcado para alguém conferir a classificação na tela.
   */
  it('código desconhecido é lido, classificado no palpite e marcado', () => {
    const guia = lerGuia(
      DARF_INSS.replace(
        '1099 CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL 234,56 234,56',
        '1410 CONTRIBUICAO NOVA QUALQUER 234,56 234,56',
      ),
    );
    const novo = guia.itens[1];
    expect(novo).toMatchObject({
      codigo: '1410',
      classe: 'FATURAMENTO',
      classeIncerta: true,
    });
  });

  /** Item perdido na leitura tem de aparecer como divergência, não passar. */
  it('avisa quando a soma dos itens não fecha com o total', () => {
    const guia = lerGuia(DARF_INSS.replace('Valor: 1.234,56', 'Valor: 9.999,99'));
    expect(conferir(guia)).toMatch(/não bate/);
  });
});

describe('parseValor', () => {
  it('entende o formato brasileiro', () => {
    expect(parseValor('4.310,76')).toBe(4310.76);
    expect(parseValor('22.688,27')).toBe(22688.27);
    expect(parseValor('178,31')).toBe(178.31);
  });
});

/**
 * Como pagar a guia. Sem isto, a conta a pagar que ela gera chega ao IXC sem
 * como ser paga — alguém teria de abrir o PDF e digitar o código à mão, que é
 * exatamente o trabalho que jogar o arquivo aqui deveria acabar.
 */
describe('a forma de pagamento que vem no documento', () => {
  it('lê a linha digitável do DARF, com os dígitos verificadores', () => {
    expect(lerGuia(DARF_INSS).pagamento).toEqual({
      forma: 'BOLETO',
      codigoBarras: '858300000123345600000000000000000000000111222334',
    });
  });

  it('lê a do DAS e a do DARE, que são o mesmo formato', () => {
    for (const texto of [DAS_SIMPLES, DARE]) {
      const p = lerGuia(texto).pagamento;
      expect(p?.forma).toBe('BOLETO');
      // Arrecadação: 48 dígitos e começa em 8. É o que o IXC aceita como
      // código de barras, e o que um banco reconhece como tributo.
      expect((p as { codigoBarras: string }).codigoBarras).toMatch(/^8\d{47}$/);
    }
  });

  /*
   * A armadilha do DARF: a linha logo abaixo da digitável começa igual e
   * termina no CNPJ da empresa. Tirar os dígitos de qualquer linha comprida
   * daria um código com cara de válido e destino nenhum.
   */
  it('não confunde a linha que termina no CNPJ com a digitável', () => {
    const p = lerGuia(DARF_INSS).pagamento as { codigoBarras: string };
    expect(p.codigoBarras).not.toContain('11222333000144');
    expect(p.codigoBarras).toHaveLength(48);
  });

  /*
   * O FGTS Digital não imprime código de barras: quem recebe é a Caixa, e ela
   * quer PIX. O payload inteiro do QR Code é o que se paga — a URL impressa
   * embaixo do rótulo "PIX Copia e Cola:" é só o endereço do QR, e colada num
   * banco não paga nada.
   */
  it('no FGTS lê o copia e cola do PIX, não a URL do rótulo', () => {
    const p = lerGuia(FGTS).pagamento;
    expect(p?.forma).toBe('PIX');
    const copiaECola = (p as { copiaECola: string }).copiaECola;
    expect(copiaECola.startsWith('00020101')).toBe(true);
    expect(copiaECola).toContain('br.gov.bcb.pix');
    expect(copiaECola).not.toMatch(/^pix-qrcode/);
  });

  it('guia sem código nem PIX não inventa forma de pagamento', () => {
    const semNada = DARF_INSS.split('\n')
      .filter((l) => !/\d{11}[-. ]?\d\s/.test(l))
      .join('\n');
    expect(lerGuia(semNada).pagamento).toBeNull();
  });
});
