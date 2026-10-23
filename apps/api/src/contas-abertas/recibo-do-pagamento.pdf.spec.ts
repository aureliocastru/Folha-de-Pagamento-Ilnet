import { gerarReciboDoPagamento, quandoFoiPago } from './recibo-do-pagamento.pdf';

/** Nomes e documentos inventados: o repositório é público. */
const pessoa = {
  nome: 'Papelaria de Mentira Ltda',
  fantasia: null,
  documento: '22.222.222/0001-22',
  endereco: null,
  telefone: null,
  email: null,
};

const dia = (d: number) => new Date(Date.UTC(2026, 9, d));

describe('o recibo de um pagamento sem comprovante de banco', () => {
  it('diz o dia e a hora em que foi pago', () => {
    expect(quandoFoiPago({ pagoEm: dia(23), registradoEm: dia(23), hora: '10:36:22' })).toBe(
      '23/10/2026 às 10:36',
    );
  });

  it('pago num dia e lançado noutro: a hora é a do lançamento, e ele diz isso', () => {
    expect(quandoFoiPago({ pagoEm: dia(15), registradoEm: dia(16), hora: '09:00:00' })).toBe(
      '15/10/2026 (registrado em 16/10/2026 às 09:00)',
    );
  });

  it('sem a hora, fica o dia', () => {
    expect(quandoFoiPago({ pagoEm: dia(23), registradoEm: dia(23), hora: null })).toBe('23/10/2026');
  });

  it('sai um PDF', async () => {
    const pdf = await gerarReciboDoPagamento({
      numero: 1,
      pagador: { ...pessoa, nome: 'Empresa de Teste Ltda', documento: '11.111.111/0001-11' },
      recebedor: pessoa,
      valorPago: 111,
      valorDoTitulo: 111,
      juros: 0,
      multa: 0,
      desconto: 0,
      pagoEm: dia(23),
      registradoEm: dia(23),
      hora: '10:36:22',
      forma: 'Dinheiro',
      saiuDe: 'Caixa de teste',
      chavePix: null,
      vencimento: dia(23),
      documento: null,
      referente: 'material de limpeza',
      emitidoEm: new Date(),
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
