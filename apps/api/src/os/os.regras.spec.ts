import type { AssuntoDoIxc } from './os-ixc';
import {
  motivoDoAssunto,
  motivoDosItensTravados,
  motivoForaDosAparelhos,
  motivoParaNaoFinalizar,
  motivoParaNaoGastar,
  motivoParaNaoInstalar,
  motivoParaNaoRetirar,
  naOrdemDeGravar,
  type ItemJaAnotado,
  type PecaLida,
} from './os.regras';

/**
 * O que o técnico pode anotar. O que este arquivo protege:
 *
 *  - aparelho de outro almoxarifado não se instala do dele;
 *  - aparelho recolhido que não passou pela base não vai para outro cliente;
 *  - a mesma peça não entra em duas OS ao mesmo tempo;
 *  - material conta o que está anotado e não enviado, senão a van fica negativa;
 *  - passar do teto pede o porquê.
 */

const van = { id: 12, nome: 'VAN CLEYSON' };

const peca: PecaLida = {
  patrimonioId: 9,
  descricao: 'ONU HUAWEI',
  almoxId: 12,
  almoxarifado: 'VAN CLEYSON',
  situacao: 'disponível',
  podeMover: true,
  impedimento: null,
};

function anotado(over: Partial<ItemJaAnotado>): ItemJaAnotado {
  return {
    tipo: 'INSTALADO',
    situacao: 'PENDENTE',
    osIxcId: 100,
    produtoId: 34,
    patrimonioId: 9,
    comodatoIxcId: null,
    quantidade: 1,
    ...over,
  };
}

describe('motivoParaNaoInstalar', () => {
  it('peça na van do técnico, disponível e sem anotação: pode', () => {
    expect(motivoParaNaoInstalar(peca, van, [])).toBeNull();
  });

  it('peça em outro almoxarifado: pede a transferência antes', () => {
    expect(
      motivoParaNaoInstalar({ ...peca, almoxId: 1, almoxarifado: 'Almoxarifado Principal' }, van, []),
    ).toMatch(/"Almoxarifado Principal".*Peça a transferência/);
  });

  it('peça fora da prateleira: diz o impedimento', () => {
    expect(
      motivoParaNaoInstalar(
        { ...peca, podeMover: false, impedimento: 'a peça está em comodato' },
        van,
        [],
      ),
    ).toMatch(/em comodato/);
  });

  it('recolhida de cliente e não recebida na base: não vai para outro cliente', () => {
    const motivo = motivoParaNaoInstalar(peca, van, [
      anotado({
        tipo: 'RETIRADO',
        situacao: 'GRAVADO',
        osIxcId: 3700,
        cliente: 'Maria',
        dia: '2026-09-20',
        recebido: false,
      }),
    ]);
    expect(motivo).toMatch(/retirado de um cliente \(Maria\) na OS 3700, em 20\/09\/2026/);
  });

  it('recolhida e já recebida na base: pode (voltou para a van depois da triagem)', () => {
    expect(
      motivoParaNaoInstalar(peca, van, [
        anotado({ tipo: 'RETIRADO', situacao: 'GRAVADO', recebido: true }),
      ]),
    ).toBeNull();
  });

  it('já anotada para instalar em outra OS ainda não gravada: não', () => {
    expect(motivoParaNaoInstalar(peca, van, [anotado({ osIxcId: 3800 })])).toMatch(/OS 3800/);
    expect(
      motivoParaNaoInstalar(peca, van, [anotado({ osIxcId: 3800, situacao: 'CONFERIR' })]),
    ).toMatch(/OS 3800/);
  });

  it('instalada antes e gravada (e depois recolhida e recebida): pode de novo', () => {
    expect(
      motivoParaNaoInstalar(peca, van, [
        anotado({ situacao: 'GRAVADO', osIxcId: 3000 }),
        anotado({ tipo: 'RETIRADO', situacao: 'GRAVADO', recebido: true, osIxcId: 3500 }),
      ]),
    ).toBeNull();
  });
});

describe('motivoParaNaoRetirar', () => {
  const comodato = {
    comodatoId: 59195,
    produtoId: 34,
    descricao: null,
    quantidade: 1,
    patrimonioId: 9,
    numeroPatrimonial: null,
    mac: null,
    numeroSerie: null,
    desde: null,
    status: 'E',
  };

  it('comodato ativo no contrato: pode', () => {
    expect(motivoParaNaoRetirar(comodato, [])).toBeNull();
  });

  it('fora do contrato: manda anotar como divergência', () => {
    expect(motivoParaNaoRetirar(undefined, [])).toMatch(/não está na lista/);
  });

  it('já baixado, ou já anotado: não', () => {
    expect(motivoParaNaoRetirar({ ...comodato, status: 'D' }, [])).toMatch(/já foi baixado/);
    expect(
      motivoParaNaoRetirar(comodato, [anotado({ tipo: 'RETIRADO', comodatoIxcId: 59195 })]),
    ).toMatch(/já está anotada na OS 100/);
  });
});

describe('motivoParaNaoGastar', () => {
  const material = {
    produtoId: 36,
    descricao: 'CONECTOR SC/APC',
    unidade: 'UN',
    ativo: true,
    maximoPorOs: 4,
  };

  it('dentro do saldo e do teto: pode', () => {
    expect(
      motivoParaNaoGastar({ material, quantidade: 2, saldo: 10, pendentes: 0, jaNestaOs: 0 }),
    ).toBeNull();
  });

  it('fora do catálogo, ou desativado: pede à base', () => {
    const base = { quantidade: 1, saldo: 10, pendentes: 0, jaNestaOs: 0 };
    expect(motivoParaNaoGastar({ ...base, material: undefined })).toMatch(/lista de materiais/);
    expect(motivoParaNaoGastar({ ...base, material: { ...material, ativo: false } })).toMatch(
      /lista de materiais/,
    );
  });

  it('o anotado e não enviado conta como saído — a van não fica negativa', () => {
    const motivo = motivoParaNaoGastar({
      material,
      quantidade: 3,
      saldo: 5,
      pendentes: 3,
      jaNestaOs: 0,
    });
    expect(motivo).toMatch(/Você tem 2 UN.*já tirando 3 anotados/);
  });

  it('acima do teto por OS pede o porquê; com o porquê, passa', () => {
    const pedido = { material, quantidade: 3, saldo: 20, pendentes: 0, jaNestaOs: 2 };
    expect(motivoParaNaoGastar(pedido)).toMatch(/até 4 UN.*ficariam 5.*porquê/);
    expect(
      motivoParaNaoGastar({ ...pedido, observacao: 'caixa de emenda refeita' }),
    ).toBeNull();
  });

  it('quantidade zero não', () => {
    expect(
      motivoParaNaoGastar({ material, quantidade: 0, saldo: 5, pendentes: 0, jaNestaOs: 0 }),
    ).toMatch(/maior que zero/);
  });
});

describe('naOrdemDeGravar', () => {
  it('instalado, retirado, material — e dentro do tipo, a ordem em que foi anotado', () => {
    const t = (tipo: ItemJaAnotado['tipo'], ms: number) => ({ tipo, createdAt: new Date(ms), id: `${tipo}${ms}` });
    const ordem = naOrdemDeGravar([
      t('MATERIAL', 1),
      t('RETIRADO', 2),
      t('INSTALADO', 4),
      t('INSTALADO', 3),
      t('DIVERGENCIA', 0),
    ]).map((i) => i.id);
    expect(ordem).toEqual(['INSTALADO3', 'INSTALADO4', 'RETIRADO2', 'MATERIAL1', 'DIVERGENCIA0']);
  });
});

describe('motivoForaDosAparelhos', () => {
  const lista = [
    { produtoId: 34, ativo: true },
    { produtoId: 40, ativo: false },
  ];

  it('modelo na lista de aparelhos: pode', () => {
    expect(motivoForaDosAparelhos(34, 'ONU HUAWEI', lista)).toBeNull();
  });

  it('ferramenta da van (patrimônio fora da lista): não se instala no cliente', () => {
    expect(motivoForaDosAparelhos(900, 'CANETA DE LIMPEZA FIBRA OPTICA', lista)).toMatch(
      /"CANETA DE LIMPEZA FIBRA OPTICA" não está na lista de aparelhos.*ferramenta/,
    );
  });

  it('modelo desativado na lista conta como fora', () => {
    expect(motivoForaDosAparelhos(40, 'ROTEADOR', lista)).toMatch(/não está na lista/);
  });

  it('sem lista nenhuma, nada se instala — e a mensagem diz o que falta', () => {
    expect(motivoForaDosAparelhos(34, 'ONU', [])).toMatch(/ainda não montou a lista de aparelhos/);
  });
});

// ---------------------------------------------------------------------------
// Finalizar a OS
// ---------------------------------------------------------------------------

describe('motivoParaNaoFinalizar', () => {
  const assunto: AssuntoDoIxc = {
    id: 4,
    nome: 'Troca de equipamento',
    respostaPadraoId: 12,
    diagnosticoObrigatorio: false,
    fotosExigidas: 0,
    aparelhosExigidos: 0,
    produtosExigidos: 0,
    equipeObrigatoria: false,
    geraComissao: false,
  };
  const agora = new Date('2026-10-22T13:00:00Z'); // 10:00 daqui
  const base = {
    status: 'EX',
    assunto,
    pedido: {
      respostaId: 12,
      diagnosticoId: null,
      relato: 'Troquei a ONU, sinal ok.',
      inicio: new Date('2026-10-22T11:30:00Z'),
    },
    respostas: [{ id: 12, nome: 'Concluída', texto: null, setorId: 0 }],
    diagnosticos: [{ id: 5, nome: 'ONU queimada', texto: null, setorId: 0 }],
    aparelhos: 0,
    produtos: 0,
    abertura: '2026-10-22 07:00:00',
    agora,
  };

  it('o pedido certo passa', () => {
    expect(motivoParaNaoFinalizar(base)).toBeNull();
  });

  it('a OS já finalizada no IXC não se finaliza de novo', () => {
    expect(motivoParaNaoFinalizar({ ...base, status: 'F' })).toMatch(/já está finalizada/);
  });

  it('o assunto que exige foto ou equipe se finaliza pelo IXC', () => {
    expect(motivoDoAssunto({ ...assunto, fotosExigidas: 2 })).toMatch(/exige 2 fotos.*pelo IXC/);
    expect(motivoDoAssunto({ ...assunto, equipeObrigatoria: true })).toMatch(/equipe.*pelo IXC/);
    expect(motivoParaNaoFinalizar({ ...base, assunto: { ...assunto, fotosExigidas: 1 } })).toMatch(/foto/);
    expect(motivoDoAssunto(assunto)).toBeNull();
  });

  it('o aparelho e o produto que o assunto exige contam o que está no IXC e o que vai antes', () => {
    const exige = { ...assunto, aparelhosExigidos: 1, produtosExigidos: 2 };
    expect(motivoParaNaoFinalizar({ ...base, assunto: exige, aparelhos: 0, produtos: 2 })).toMatch(
      /1 aparelho\(s\).*tem 0.*Instalei/,
    );
    expect(motivoParaNaoFinalizar({ ...base, assunto: exige, aparelhos: 1, produtos: 1 })).toMatch(
      /2 produto\(s\).*tem 1.*Gastei/,
    );
    expect(motivoParaNaoFinalizar({ ...base, assunto: exige, aparelhos: 1, produtos: 2 })).toBeNull();
  });

  it('a resposta e o diagnóstico têm de existir, e o diagnóstico obrigatório tem de vir', () => {
    expect(motivoParaNaoFinalizar({ ...base, pedido: { ...base.pedido, respostaId: 99 } })).toMatch(/resposta/);
    expect(motivoParaNaoFinalizar({ ...base, pedido: { ...base.pedido, diagnosticoId: 99 } })).toMatch(
      /diagnóstico/,
    );
    const exigeDiagnostico = { ...base, assunto: { ...assunto, diagnosticoObrigatorio: true } };
    expect(motivoParaNaoFinalizar(exigeDiagnostico)).toMatch(/exige o diagnóstico/);
    expect(
      motivoParaNaoFinalizar({ ...exigeDiagnostico, pedido: { ...base.pedido, diagnosticoId: 5 } }),
    ).toBeNull();
    // Sem resposta pode: no IXC ela é opcional.
    expect(motivoParaNaoFinalizar({ ...base, pedido: { ...base.pedido, respostaId: null } })).toBeNull();
  });

  it('o relato vazio não passa', () => {
    expect(motivoParaNaoFinalizar({ ...base, pedido: { ...base.pedido, relato: '  ok ' } })).toMatch(
      /o que foi feito/,
    );
  });

  it('o início não pode estar no futuro, nem antes da abertura da OS', () => {
    const em = (iso: string) => ({ ...base, pedido: { ...base.pedido, inicio: new Date(iso) } });
    expect(motivoParaNaoFinalizar(em('2026-10-22T13:30:00Z'))).toMatch(/futuro/);
    // Cinco minutos de folga para o relógio do celular.
    expect(motivoParaNaoFinalizar(em('2026-10-22T13:04:00Z'))).toBeNull();
    expect(motivoParaNaoFinalizar(em('2026-10-22T09:59:00Z'))).toMatch(/antes da abertura da OS \(22\/10, 07:00\)/);
    expect(motivoParaNaoFinalizar(em('invalido'))).toMatch(/hora/);
  });
});

describe('motivoDosItensTravados', () => {
  it('tudo no IXC não trava', () => {
    expect(motivoDosItensTravados([])).toBeNull();
  });

  it('diz o que está segurando o fechamento', () => {
    expect(
      motivoDosItensTravados([{ situacao: 'FALHOU' }, { situacao: 'CONFERIR' }, { situacao: 'PENDENTE' }]),
    ).toBe(
      'A OS não foi finalizada: tem 1 item(ns) recusado(s) pelo IXC, 1 item(ns) esperando a base ' +
        'conferir no IXC, 1 item(ns) que ainda não foram ao IXC. Ela se finaliza depois que eles ' +
        'estiverem no IXC.',
    );
  });
});
