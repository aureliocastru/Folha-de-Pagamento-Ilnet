import { CategoriasService } from './categorias.service';

/**
 * A conta paga de uma vez com várias notas é um título só no IXC, mas nos
 * relatórios ela se divide pelas categorias das notas — como a fatura do
 * cartão se divide pelas compras. O que se protege:
 *
 *  - cada nota soma na categoria dela, com o grupo junto;
 *  - a nota sem categoria fica com a etiqueta do título;
 *  - título sem notas não entra no mapa: para ele vale a etiqueta de sempre.
 */

const VEICULOS = { id: 'g', nome: 'Máquinas e Veículos' };
const PECAS = { id: 'c-pecas', nome: 'Peças', pai: VEICULOS };
const ESCRITORIO = { id: 'c-escritorio', nome: 'Escritório', pai: null };

function montar() {
  const prisma = {
    contaPagar: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        // A pergunta das faturas filtra pelo cartão; a das notas, pelas partes.
        'partes' in where
          ? [
              {
                idFnApagarIxc: 900,
                partes: [
                  { valor: 120, categoria: PECAS },
                  { valor: 80, categoria: PECAS },
                  { valor: 150, categoria: ESCRITORIO },
                  { valor: 50, categoria: null },
                ],
              },
            ]
          : [],
      ),
    },
    classificacaoConta: {
      findMany: jest.fn(async () => [
        {
          idFnApagar: 900,
          categoria: { id: 'c-servicos', nome: 'Serviços', pai: null },
        },
      ]),
    },
  };
  return new CategoriasService(prisma as never);
}

describe('rateio da conta com várias notas', () => {
  it('divide o título pelas categorias das notas', async () => {
    const rateios = await montar().rateiosDosTitulos([900, 901]);

    expect(rateios.get(900)).toEqual([
      { classificacao: { id: 'c-pecas', nome: 'Peças', grupo: VEICULOS }, valor: 200 },
      { classificacao: { id: 'c-escritorio', nome: 'Escritório', grupo: null }, valor: 150 },
      // A nota sem categoria vai para a etiqueta do título.
      { classificacao: { id: 'c-servicos', nome: 'Serviços', grupo: null }, valor: 50 },
    ]);
    expect(rateios.has(901)).toBe(false);
  });
});
