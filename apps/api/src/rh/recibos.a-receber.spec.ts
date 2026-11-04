import {
  aReceberDoRecibo,
  donoNaFolha,
  type FuncionarioDaFolha,
} from './recibos.a-receber';

// Nomes e CPFs inventados: o repositório é público.
function func(over: Partial<FuncionarioDaFolha>): FuncionarioDaFolha {
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

describe('donoNaFolha', () => {
  it('acha pelo CPF, sem depender da pasta', () => {
    const fulano = func({ id: 'f1' });
    const outro = func({ id: 'f2', cpf: '55566677788' });
    expect(donoNaFolha('11122233344', null, [outro, fulano])).toBe(fulano);
    // Mesmo com a pasta de outra pessoa escolhida na tela: quem diz é o CPF.
    expect(donoNaFolha('11122233344', 'f2', [outro, fulano])).toBe(fulano);
  });

  it('CPF repetido: o da pasta, senão o único ativo, senão ninguém', () => {
    const velho = func({ id: 'velho', ativo: false });
    const novo = func({ id: 'novo' });
    expect(donoNaFolha('11122233344', 'velho', [velho, novo])).toBe(velho);
    expect(donoNaFolha('11122233344', null, [velho, novo])).toBe(novo);
    const outroAtivo = func({ id: 'outro' });
    expect(donoNaFolha('11122233344', null, [novo, outroAtivo])).toBeNull();
  });

  it('mesmo CPF fora e dentro da folha: vale o de dentro', () => {
    const fornecedor = func({ id: 'forn', naFolha: false });
    const daCasa = func({ id: 'casa' });
    expect(donoNaFolha('11122233344', null, [fornecedor, daCasa])).toBe(daCasa);
  });

  it('sem CPF no cadastro, vale a pasta', () => {
    const semCpf = func({ id: 'f9', cpf: '' });
    expect(donoNaFolha('11122233344', 'f9', [semCpf])).toBe(semCpf);
  });

  it('a pasta não vence um cadastro com outro CPF', () => {
    const homonimo = func({ id: 'f9', cpf: '99988877766' });
    expect(donoNaFolha('11122233344', 'f9', [homonimo])).toBeNull();
  });
});

describe('aReceberDoRecibo', () => {
  it('troca pelo líquido', () => {
    expect(aReceberDoRecibo(1234.56, func({ aReceber: 987.65 }), true)).toMatchObject({
      funcionarioId: 'f1',
      antes: 987.65,
      depois: 1234.56,
      motivo: null,
    });
  });

  it('já igual não troca, e não é problema', () => {
    expect(aReceberDoRecibo(987.65, func({ aReceber: 987.65 }), true)).toMatchObject({
      depois: null,
      motivo: null,
    });
  });

  it('cadastro sem valor nenhum ganha o líquido', () => {
    expect(aReceberDoRecibo(500, func({ aReceber: null }), true).depois).toBe(500);
  });

  it('mês mais velho que o último separado não troca', () => {
    expect(aReceberDoRecibo(1234.56, func({}), false)).toMatchObject({
      depois: null,
      motivo: null,
    });
  });

  it('sem dono ou sem líquido, avisa e não troca', () => {
    expect(aReceberDoRecibo(1234.56, null, true)).toMatchObject({
      depois: null,
      motivo: 'sem-cadastro',
    });
    expect(aReceberDoRecibo(null, func({}), true)).toMatchObject({
      depois: null,
      motivo: 'sem-liquido',
    });
  });

  it('cadastro fora da folha não troca, e avisa', () => {
    expect(aReceberDoRecibo(1234.56, func({ naFolha: false }), true)).toMatchObject({
      depois: null,
      motivo: 'fora-da-folha',
    });
  });

  it('sem carteira assinada troca, mas avisa que a folha não usa', () => {
    expect(
      aReceberDoRecibo(1234.56, func({ carteiraAssinada: false }), true),
    ).toMatchObject({ depois: 1234.56, motivo: 'sem-carteira' });
  });
});
