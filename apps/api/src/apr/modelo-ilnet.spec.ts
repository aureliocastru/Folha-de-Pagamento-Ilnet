import { CategoriaItemApr } from '@prisma/client';
import { MODELO_ILNET, type ItemSemente } from './modelo-ilnet';

/**
 * O que a APR nova já traz marcado.
 *
 * É a única parte da semente que responde por uma decisão de segurança, e não
 * pela transcrição do papel: dizer que um risco existe antes de o técnico
 * olhar. Por isso a lista é curta, é explícita, e está provada aqui — um risco
 * a mais marcado sem querer é uma análise que ninguém fez.
 */

const itens = (categoria: CategoriaItemApr): ItemSemente[] =>
  MODELO_ILNET.itens.filter((i) => i.categoria === categoria);

const marcados = (categoria: CategoriaItemApr): string[] =>
  itens(categoria)
    .filter((i) => i.marcadoPorPadrao)
    .map((i) => i.texto);

describe('o que já vem marcado na APR nova', () => {
  it('traz todas as normas — nenhuma delas é escolha de serviço', () => {
    const normas = itens(CategoriaItemApr.NORMA);

    expect(normas.length).toBeGreaterThan(0);
    expect(marcados(CategoriaItemApr.NORMA)).toEqual(
      normas.map((n) => n.texto),
    );
  });

  it('traz os riscos do poste, e só eles', () => {
    expect(marcados(CategoriaItemApr.RISCO).sort()).toEqual(
      [
        'Choque elétrico',
        'Descarga elétrica',
        'Quedas',
        'Quedas de altura',
        'Queimaduras',
      ].sort(),
    );
  });

  /*
   * O raio depende do tempo e a queda de objeto depende de quem está embaixo:
   * marcá-los de antemão seria responder pelo técnico uma pergunta que só quem
   * está no local pode responder.
   */
  it('deixa em branco o risco que muda de serviço para serviço', () => {
    const emBranco = [
      'Descargas atmosféricas',
      'Vento forte',
      'Chuva',
      'Trânsito de veículos',
      'Queda de objetos',
      'Animais peçonhentos',
    ];

    for (const texto of emBranco) {
      const item = itens(CategoriaItemApr.RISCO).find((i) => i.texto === texto);
      expect(item).toBeDefined();
      expect(item?.marcadoPorPadrao).toBe(false);
    }
  });

  /*
   * A lista de partida casa com a grade pelo texto exato. Renomear um risco na
   * grade sem renomear lá faria a marcação sumir sem avisar ninguém — e o
   * técnico só descobriria olhando um formulário que ele já não confere.
   */
  it('não marca por padrão nada fora das categorias de marcar', () => {
    const marcaveis: CategoriaItemApr[] = [
      CategoriaItemApr.NORMA,
      CategoriaItemApr.ATIVIDADE,
      CategoriaItemApr.RISCO,
      CategoriaItemApr.FERRAMENTA,
      CategoriaItemApr.PROTECAO,
    ];

    const forasteiros = MODELO_ILNET.itens.filter(
      (i) => i.marcadoPorPadrao && !marcaveis.includes(i.categoria),
    );

    expect(forasteiros).toEqual([]);
  });

  it('não marca a atividade, a ferramenta nem o EPI — esses são do dia', () => {
    expect(marcados(CategoriaItemApr.ATIVIDADE)).toEqual([]);
    expect(marcados(CategoriaItemApr.FERRAMENTA)).toEqual([]);
    expect(marcados(CategoriaItemApr.PROTECAO)).toEqual([]);
  });

  it('deixa o "Outros, quais?" em branco — marcado e vazio trava a liberação', () => {
    const outros = itens(CategoriaItemApr.RISCO).find((i) => i.pedeDetalhe);

    expect(outros?.texto).toBe('Outros, quais?');
    expect(outros?.marcadoPorPadrao).toBeFalsy();
  });
});
