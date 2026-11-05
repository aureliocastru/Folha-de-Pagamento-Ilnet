import type { FuncionarioDaFolha } from './recibos.a-receber';
import {
  bonusDoRecibo,
  descricaoDoBonus13,
  folhaDoBonus13,
} from './recibos.decimo-terceiro';

// Nomes e CPFs inventados: o repositório é público.
function func(over: Partial<FuncionarioDaFolha> = {}): FuncionarioDaFolha {
  return {
    id: 'f1',
    nome: 'Fulano de Tal',
    cpf: '11122233344',
    ativo: true,
    naFolha: true,
    carteiraAssinada: true,
    aReceber: 900,
    ...over,
  };
}

const nenhuma = new Set<string>();

describe('o bônus do 13º', () => {
  it('diz que é o 13º e de que parcela', () => {
    expect(descricaoDoBonus13(1, '2026')).toBe('13º salário 2026 — 1ª parcela');
    expect(descricaoDoBonus13(2, '2026')).toBe('13º salário 2026 — 2ª parcela');
  });

  it('sai na folha do quinto dia do mês impresso: o mês trabalhado é o anterior', () => {
    const b = bonusDoRecibo(1321.35, func(), null, '2026-11', nenhuma);
    expect(b).toMatchObject({
      funcionarioId: 'f1',
      lancamentoId: null,
      antes: null,
      depois: 1321.35,
      folha: '2026-11',
      mesTrabalhado: '2026-10',
      aviso: null,
    });
  });

  it('folha que já saiu para a pessoa passa para a seguinte', () => {
    expect(folhaDoBonus13('2026-11', new Set(['2026-11']))).toBe('2026-12');
    expect(folhaDoBonus13('2026-12', new Set(['2026-12', '2027-01']))).toBe('2027-02');
    const b = bonusDoRecibo(500, func(), null, '2026-11', new Set(['2026-11']));
    expect(b.folha).toBe('2026-12');
    expect(b.mesTrabalhado).toBe('2026-11');
  });

  it('o mesmo PDF de novo não cria outro bônus', () => {
    const existente = { id: 'l1', valor: 500, competencia: '2026-10' };
    const igual = bonusDoRecibo(500, func(), existente, '2026-11', nenhuma);
    expect(igual).toMatchObject({ lancamentoId: 'l1', depois: null, aviso: null });

    const outroValor = bonusDoRecibo(520, func(), existente, '2026-11', nenhuma);
    expect(outroValor).toMatchObject({
      lancamentoId: 'l1',
      antes: 500,
      depois: 520,
      folha: '2026-11',
      mesTrabalhado: '2026-10',
    });
  });

  it('bônus que já saiu na folha não muda de valor', () => {
    const existente = { id: 'l1', valor: 500, competencia: '2026-10' };
    const b = bonusDoRecibo(520, func(), existente, '2026-11', new Set(['2026-11']));
    expect(b.depois).toBeNull();
    expect(b.motivo).toBe('ja-pago');
  });

  it('sem a quem pagar pela folha, não há bônus', () => {
    expect(bonusDoRecibo(null, func(), null, '2026-11', nenhuma).motivo).toBe(
      'sem-liquido',
    );
    expect(bonusDoRecibo(500, null, null, '2026-11', nenhuma).motivo).toBe(
      'sem-cadastro',
    );
    expect(
      bonusDoRecibo(500, func({ naFolha: false }), null, '2026-11', nenhuma).motivo,
    ).toBe('fora-da-folha');
    expect(
      bonusDoRecibo(500, func({ ativo: false }), null, '2026-11', nenhuma).motivo,
    ).toBe('inativo');
  });

  it('a carteira assinada não importa: o 13º é pago igual', () => {
    const b = bonusDoRecibo(500, func({ carteiraAssinada: false }), null, '2026-11', nenhuma);
    expect(b.depois).toBe(500);
    expect(b.aviso).toBeNull();
  });
});
