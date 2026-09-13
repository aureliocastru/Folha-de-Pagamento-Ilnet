import {
  dizerLancamento,
  pecaDaLinha,
  planejarPecas,
  planejarPorQuantidade,
  type PecaNoAlmoxarifado,
} from './conferencia';
import { ehAlmoxDePerdas, montarEstoque, resumirEstoque } from './estoque.mapper';

/**
 * A regra da conferência: quem contou diz quanto tem, e o sistema decide o que
 * lançar no IXC. Errar aqui não dá erro em lugar nenhum — dá uma ONU mandada
 * para Perdas que estava na prateleira, ou uma compra do que já existia.
 */

describe('planejarPorQuantidade', () => {
  it('bateu: nada a lançar', () => {
    expect(planejarPorQuantidade({ sistema: 25, contado: 25, saldoEmPerdas: 10 })).toEqual({
      diferenca: 0,
      paraPerdas: 0,
      voltaDePerdas: 0,
      compra: 0,
    });
  });

  it('faltou: a diferença vai para Perdas e Falhas', () => {
    expect(planejarPorQuantidade({ sistema: 25, contado: 20, saldoEmPerdas: 0 })).toEqual({
      diferenca: -5,
      paraPerdas: 5,
      voltaDePerdas: 0,
      compra: 0,
    });
  });

  it('não existe mais: contado zero leva tudo para Perdas', () => {
    expect(planejarPorQuantidade({ sistema: 7, contado: 0, saldoEmPerdas: 3 }).paraPerdas).toBe(7);
  });

  it('sobrou: volta primeiro o que está em Perdas, e só o resto é compra', () => {
    expect(planejarPorQuantidade({ sistema: 20, contado: 25, saldoEmPerdas: 2 })).toEqual({
      diferenca: 5,
      paraPerdas: 0,
      voltaDePerdas: 2,
      compra: 3,
    });
  });

  it('sobrou menos do que tem em Perdas: não compra nada', () => {
    expect(planejarPorQuantidade({ sistema: 20, contado: 22, saldoEmPerdas: 9 })).toMatchObject({
      voltaDePerdas: 2,
      compra: 0,
    });
  });

  it('saldo negativo: o contado zera o negativo e soma o resto', () => {
    expect(planejarPorQuantidade({ sistema: -3, contado: 2, saldoEmPerdas: 0 })).toMatchObject({
      diferenca: 5,
      compra: 5,
    });
  });

  it('Perdas negativo não devolve nada', () => {
    expect(planejarPorQuantidade({ sistema: 0, contado: 4, saldoEmPerdas: -2 })).toMatchObject({
      voltaDePerdas: 0,
      compra: 4,
    });
  });

  it('cabo com casas: 100,5 m contra 100,25 m', () => {
    expect(planejarPorQuantidade({ sistema: 100.25, contado: 100.5, saldoEmPerdas: 0 }).compra).toBe(0.25);
  });

  it('resto de conta não é diferença', () => {
    expect(planejarPorQuantidade({ sistema: 0.1 + 0.2, contado: 0.3, saldoEmPerdas: 0 }).diferenca).toBe(0);
  });
});

function peca(id: number, situacao = '1', identificada = true): PecaNoAlmoxarifado {
  return { patrimonioId: id, situacao, identificada };
}

describe('planejarPecas — pela quantidade', () => {
  it('contou o que o IXC tem: nada a lançar', () => {
    const p = planejarPecas({ saldo: 3, pecas: [peca(1), peca(2), peca(3)], achadas: null, contado: 3, trazidas: 0, semCadastro: 0 });
    expect(p).toMatchObject({ precisaBipar: false, semPecaParaPerdas: 0, compra: 0, paraPerdas: [] });
  });

  it('saldo sem peça (756 de saldo, 3 peças): o que não se contou sai pela quantidade', () => {
    const p = planejarPecas({ saldo: 756, pecas: [peca(1), peca(2), peca(3)], achadas: null, contado: 300, trazidas: 0, semCadastro: 0 });
    expect(p).toMatchObject({ precisaBipar: false, saldoSemPeca: 753, semPecaParaPerdas: 456, compra: 0 });
  });

  it('contou menos que as peças cadastradas: precisa bipar para saber qual faltou', () => {
    const p = planejarPecas({ saldo: 25, pecas: Array.from({ length: 25 }, (_, i) => peca(i + 1)), achadas: null, contado: 20, trazidas: 0, semCadastro: 0 });
    expect(p.precisaBipar).toBe(true);
    expect(p.paraPerdas).toEqual([]);
    expect(p.semPecaParaPerdas).toBe(0);
  });

  it('contou mais que o saldo: o resto é compra', () => {
    const p = planejarPecas({ saldo: 2, pecas: [peca(1), peca(2)], achadas: null, contado: 5, trazidas: 0, semCadastro: 0 });
    expect(p).toMatchObject({ compra: 3, semPecaParaPerdas: 0 });
  });
});

describe('planejarPecas — por peça', () => {
  const vinteECinco = Array.from({ length: 25 }, (_, i) => peca(i + 1));

  it('bipou 20 de 25: as 5 não achadas vão para Perdas', () => {
    const p = planejarPecas({ saldo: 25, pecas: vinteECinco, achadas: vinteECinco.slice(0, 20).map((x) => x.patrimonioId), trazidas: 0, semCadastro: 0 });
    expect(p.contado).toBe(20);
    expect(p.paraPerdas).toEqual([21, 22, 23, 24, 25]);
    expect(p.ficamPorFaltaDeSaldo).toEqual([]);
    expect(p.semPecaParaPerdas).toBe(0);
  });

  it('a peça presa no IXC não achada não vai: fica como pendência', () => {
    const p = planejarPecas({ saldo: 3, pecas: [peca(1), peca(2, '8'), peca(3, '6')], achadas: [1], trazidas: 0, semCadastro: 0 });
    expect(p.paraPerdas).toEqual([]);
    expect(p.presasNaoAchadas).toEqual([2, 3]);
  });

  it('mais peças que saldo: vai só o que não deixa a achada sem saldo, e a identificada antes da vazia', () => {
    const p = planejarPecas({
      saldo: 2,
      pecas: [peca(1), peca(2, '1', false), peca(3)],
      achadas: [1],
      trazidas: 0,
      semCadastro: 0,
    });
    expect(p.paraPerdas).toEqual([3]);
    expect(p.ficamPorFaltaDeSaldo).toEqual([2]);
  });

  it('saldo sem peça sai também, e as faltas continuam cabendo', () => {
    const p = planejarPecas({ saldo: 27, pecas: vinteECinco, achadas: vinteECinco.slice(0, 20).map((x) => x.patrimonioId), trazidas: 0, semCadastro: 0 });
    expect(p.semPecaParaPerdas).toBe(2);
    expect(p.paraPerdas).toHaveLength(5);
  });

  it('contado = achadas + trazidas + sem cadastro, e a sem cadastro é compra', () => {
    const p = planejarPecas({ saldo: 2, pecas: [peca(1), peca(2)], achadas: [1, 2], trazidas: 3, semCadastro: 1 });
    expect(p.contado).toBe(6);
    expect(p.compra).toBe(1);
    expect(p.paraPerdas).toEqual([]);
  });

  it('bipada que não é deste almoxarifado não conta, e é apontada', () => {
    const p = planejarPecas({ saldo: 1, pecas: [peca(1)], achadas: [1, 99], trazidas: 0, semCadastro: 0 });
    expect(p.desconhecidas).toEqual([99]);
    expect(p.contado).toBe(1);
  });
});

describe('pecaDaLinha', () => {
  it('ONU de verdade: número da casa e série da etiqueta', () => {
    expect(pecaDaLinha({ id: '31687', situacao: '7', serial: '36249', id_mac: '', serial_fornecedor: 'FHTTBFFCB068' }))
      .toEqual({ patrimonioId: 31687, situacao: '7', identificada: true });
  });

  it('a peça que a compra criou vazia ("ZUK6L") não é identificada', () => {
    expect(pecaDaLinha({ id: '31717', situacao: '7', serial: 'ZUK6L', id_mac: '', serial_fornecedor: '' }).identificada)
      .toBe(false);
  });
});

describe('Perdas e Falhas no estoque', () => {
  it('reconhece o almoxarifado pelo nome, sem caixa nem acento', () => {
    expect(ehAlmoxDePerdas('Perdas e Falhas')).toBe(true);
    expect(ehAlmoxDePerdas('  PERDAS  E FALHAS ')).toBe(true);
    expect(ehAlmoxDePerdas('EQUIPAMENTOS PERDIDOS')).toBe(false);
  });

  it('o que está em Perdas aparece, mas não soma no que a casa tem', () => {
    const [item] = montarEstoque([
      { id_produto: '70', produto_descricao: 'ONU', id_almox: '1', almox_descricao: 'Principal', saldo: '20', produto_preco_base: '100' },
      { id_produto: '70', produto_descricao: 'ONU', id_almox: '43', almox_descricao: 'Perdas e Falhas', saldo: '5', produto_preco_base: '100' },
    ]);
    expect(item.saldos.find((s) => s.almoxId === 43)?.perdas).toBe(true);
    expect(item.total).toBe(20);
    expect(resumirEstoque([item]).valorEmEstoque).toBe(2000);
  });
});

describe('dizerLancamento', () => {
  const principal = { id: 1, nome: 'Principal' };
  const perdas = { id: 43, nome: 'Perdas e Falhas' };

  it('diz a transferência com o número do IXC', () => {
    expect(
      dizerLancamento(
        { tipo: 'transferencia', motivo: 'falta', transferenciaId: 812, de: principal, para: perdas, quantidade: 5, ok: true },
        'UND',
      ),
    ).toBe('5 UND de Principal para Perdas e Falhas (transferência #812)');
  });

  it('diz a compra que não entrou, com o porquê', () => {
    expect(
      dizerLancamento({ tipo: 'compra', motivo: 'sobra', entradaId: null, quantidade: 2.5, valorUnitario: 3, ok: false, erro: 'recusou' }, 'M'),
    ).toBe('a compra de acerto de 2,5 M não entrou (recusou)');
  });
});
