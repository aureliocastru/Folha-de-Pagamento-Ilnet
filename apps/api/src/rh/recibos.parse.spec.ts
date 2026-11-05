import {
  arrumarNome,
  chaveDoNome,
  lerLiquido,
  lerRecibos,
  parcelaDo13,
} from './recibos.parse';

/**
 * O PDF de recibos da contabilidade, como o extrator de texto o entrega.
 *
 * Nomes, CPF e CNPJ são inventados — este repositório é público, e recibo de
 * pagamento é justamente o papel que não pode vazar daqui. O que se copia do
 * arquivo real é o **desenho**: a ordem dos rótulos, e o fato de o CPF sair
 * antes do "CPF:" que o nomeia, que é como a extração embaralha as colunas.
 */
function pagina(over: Partial<Record<string, string>> = {}): string {
  const d = {
    competencia: 'Julho de 2026',
    matricula: '000081',
    nome: 'FULANO DE TAL SOBRENOME',
    cpf: '111.222.333-44',
    cargo: 'INSTALADOR E REPARADOR DE REDES',
    liquido: '1.627,05',
    titulo: 'Folha de Pagamento',
    ...over,
  };
  return (
    'Data e Assinatura ____________________ ___/___/____ ' +
    `Recibo de Pagamento ( ${d.titulo} ) ` +
    `Competência ${d.competencia} Inscrição 11.111.111/0001-11 ` +
    'Empregador EMPRESA DE MENTIRA LTDA ' +
    `Admissão 07/06/2025 Lotação GERAL Cargo ${d.cargo} ` +
    `Empregado ${d.matricula} ${d.nome} ` +
    `Banco Agência Conta Tipo de Conta ${d.cpf} CPF: ` +
    'Discriminação das Verbas Desconto Provento Referência Descrição Cod. ' +
    '1.621,00 31 dia(s) Salário-Base 011 Total de Proventos 3.101,20 ' +
    `Total de Descontos 1.474,15 Líquido a Receber ${d.liquido} ` +
    'Salário Contratual 1.621,00 Base de Cálculo do IRRF(S)'
  );
}

describe('o recibo do 13º salário', () => {
  it('a folha do mês não é 13º', () => {
    expect(lerRecibos([pagina()]).parcelaDo13).toBeNull();
  });

  it('o adiantamento é a 1ª parcela, no mês impresso', () => {
    const leitura = lerRecibos([
      pagina({
        titulo: 'Adiantamento de 13º Salário',
        competencia: 'Novembro de 2026',
        liquido: '1.234,56',
      }),
    ]);
    expect(leitura.parcelaDo13).toBe(1);
    expect(leitura.competencia).toBe('2026-11');
    expect(leitura.recibos[0].liquido).toBe(1234.56);
  });

  it('o 13º sem adiantamento no título é a 2ª parcela', () => {
    expect(parcelaDo13('13º Salário')).toBe(2);
    expect(parcelaDo13('13º Salário - 2ª Parcela')).toBe(2);
    expect(parcelaDo13('Décimo Terceiro Salário')).toBe(2);
    expect(parcelaDo13('13º Salário - 1ª Parcela')).toBe(1);
    expect(parcelaDo13('Folha de Pagamento')).toBeNull();
    expect(parcelaDo13('Férias')).toBeNull();
  });

  it('competência sem mês: o mês em que a parcela é devida', () => {
    const leitura = lerRecibos([
      pagina({ titulo: '13º Salário', competencia: '13º Salário de 2026' }),
    ]);
    expect(leitura.parcelaDo13).toBe(2);
    expect(leitura.competencia).toBe('2026-12');
  });
});

describe('o recibo de pagamento que a contabilidade manda', () => {
  it('acha o dono de cada página', () => {
    const leitura = lerRecibos([
      pagina(),
      pagina({ matricula: '000082', nome: 'BELTRANA DA SILVA', cpf: '555.666.777-88' }),
    ]);

    expect(leitura.competencia).toBe('2026-07');
    expect(leitura.competenciaEscrita).toBe('Julho de 2026');
    expect(leitura.recibos).toHaveLength(2);
    expect(leitura.recibos[0]).toMatchObject({
      paginas: [1],
      matricula: '000081',
      nome: 'Fulano de Tal Sobrenome',
      cpf: '11122233344',
      cargo: 'INSTALADOR E REPARADOR DE REDES',
    });
    expect(leitura.recibos[1].nome).toBe('Beltrana da Silva');
  });

  it('lê o líquido a receber de cada um', () => {
    const leitura = lerRecibos([
      pagina(),
      pagina({ matricula: '000082', liquido: '433,32' }),
    ]);
    expect(leitura.recibos.map((r) => r.liquido)).toEqual([1627.05, 433.32]);
    // O "Salário Contratual" logo depois não é o líquido.
    expect(lerLiquido('Líquido a Receber 1.874,13 Salário Contratual 1.621,00')).toBe(1874.13);
    expect(lerLiquido('Total de Proventos 2.034,35')).toBeNull();
  });

  it('no recibo que transborda, o líquido é o da página do fim', () => {
    const leitura = lerRecibos([
      pagina({ liquido: '' }),
      pagina({ liquido: '2.100,50' }),
    ]);
    expect(leitura.recibos).toHaveLength(1);
    expect(leitura.recibos[0].liquido).toBe(2100.5);
  });

  /*
   * Um mês com muitas verbas transborda para a página de baixo. Separar as duas
   * daria dois documentos pela metade na pasta de uma pessoa só.
   */
  it('páginas seguidas do mesmo empregado são um recibo só', () => {
    const leitura = lerRecibos([pagina(), pagina(), pagina({ matricula: '000082' })]);

    expect(leitura.recibos).toHaveLength(2);
    expect(leitura.recibos[0].paginas).toEqual([1, 2]);
    expect(leitura.recibos[1].paginas).toEqual([3]);
  });

  /*
   * Página que não dá para reconhecer é contada, e não descartada em silêncio:
   * quem sobe um arquivo de 23 páginas e vê 22 recibos precisa saber qual
   * ficou de fora.
   */
  it('conta a página que não deu para reconhecer', () => {
    const leitura = lerRecibos([pagina(), 'Relação de Salários por Departamento']);

    expect(leitura.recibos).toHaveLength(1);
    expect(leitura.paginasSemDono).toEqual([2]);
  });

  it('sem competência impressa, não inventa uma', () => {
    const leitura = lerRecibos(['Empregado 000081 FULANO DE TAL Banco Agência']);

    expect(leitura.competencia).toBeNull();
    expect(leitura.recibos).toHaveLength(1);
  });

  it('lê as competências escritas por extenso', () => {
    expect(lerRecibos([pagina({ competencia: 'Janeiro de 2027' })]).competencia).toBe(
      '2027-01',
    );
    expect(lerRecibos([pagina({ competencia: 'Março de 2026' })]).competencia).toBe(
      '2026-03',
    );
    expect(lerRecibos([pagina({ competencia: 'Dezembro de 2025' })]).competencia).toBe(
      '2025-12',
    );
  });
});

describe('o nome, do carimbo para a tela', () => {
  /* Caixa alta numa lista de pastas é ruído: some a diferença entre o nome e o
     resto da interface. */
  it('tira a caixa alta e deixa as partículas minúsculas', () => {
    expect(arrumarNome('ANDERSON CONCEICAO DE AGUIAR')).toBe(
      'Anderson Conceicao de Aguiar',
    );
    expect(arrumarNome('MARIA DOS SANTOS E SILVA')).toBe(
      'Maria dos Santos e Silva',
    );
  });

  it('a chave de comparação ignora acento e caixa', () => {
    expect(chaveDoNome('José da Silva')).toBe(chaveDoNome('JOSE DA SILVA'));
    expect(chaveDoNome('João')).not.toBe(chaveDoNome('João Pedro'));
  });
});
