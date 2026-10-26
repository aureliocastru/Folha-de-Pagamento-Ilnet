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
    diagnosticoObrigatorio: false,
    fotosExigidas: 0,
    aparelhosExigidos: 0,
    produtosExigidos: 0,
    equipeObrigatoria: false,
    assinaturaObrigatoria: false,
    geraComissao: false,
  };
  const agora = new Date('2026-10-22T13:00:00Z'); // 10:00 daqui
  const base = {
    status: 'EX',
    assunto,
    pedido: {
      relato: 'Troquei a ONU, sinal ok.',
      inicio: new Date('2026-10-22T11:30:00Z') as Date | null,
      assinadaPor: null as string | null,
      semAssinatura: null as string | null,
    },
    aparelhos: 0,
    produtos: 0,
    fotos: 0,
    assinaturaNaOs: false,
    abertura: '2026-10-22 07:00:00',
    agora,
  };

  it('o pedido certo passa', () => {
    expect(motivoParaNaoFinalizar(base)).toBeNull();
  });

  it('a OS já finalizada no IXC não se finaliza de novo', () => {
    expect(motivoParaNaoFinalizar({ ...base, status: 'F' })).toMatch(/já está finalizada/);
  });

  it('o assunto que exige equipe se finaliza pelo IXC; o que exige foto, não mais', () => {
    expect(motivoDoAssunto({ ...assunto, equipeObrigatoria: true })).toMatch(/equipe.*pelo IXC/);
    expect(motivoParaNaoFinalizar({ ...base, assunto: { ...assunto, equipeObrigatoria: true } })).toMatch(
      /equipe/,
    );
    expect(motivoDoAssunto({ ...assunto, fotosExigidas: 2 })).toBeNull();
    expect(motivoDoAssunto(assunto)).toBeNull();
  });

  it('as fotos que o assunto exige contam o que está na OS no IXC', () => {
    const exige = { ...assunto, fotosExigidas: 2 };
    expect(motivoParaNaoFinalizar({ ...base, assunto: exige })).toMatch(/exige 2 fotos.*tem nenhuma no IXC/);
    expect(motivoParaNaoFinalizar({ ...base, assunto: exige, fotos: 1 })).toMatch(/tem 1 no IXC\. Anexe/);
    expect(motivoParaNaoFinalizar({ ...base, assunto: exige, fotos: 2 })).toBeNull();
    // Não há teto: o técnico anexa quantas quiser.
    expect(motivoParaNaoFinalizar({ ...base, fotos: 25 })).toBeNull();
  });

  it('o assunto que exige assinatura só fecha com ela nos arquivos da OS', () => {
    const exige = { ...assunto, assinaturaObrigatoria: true };
    const assinou = { ...base.pedido, assinadaPor: 'Maria da Silva' };
    expect(motivoParaNaoFinalizar({ ...base, assunto: exige })).toMatch(/exige a assinatura do cliente/);
    // Dizer que assinou não basta: ela tem de estar lá.
    expect(motivoParaNaoFinalizar({ ...base, assunto: exige, pedido: assinou })).toMatch(/exige a assinatura/);
    // E o motivo de não ter assinado não serve para o assunto que a exige.
    const semAssinar = { ...base.pedido, semAssinatura: 'Não estava em casa' };
    expect(motivoParaNaoFinalizar({ ...base, assunto: exige, pedido: semAssinar })).toMatch(/exige a assinatura/);
    expect(
      motivoParaNaoFinalizar({ ...base, assunto: exige, pedido: assinou, assinaturaNaOs: true }),
    ).toBeNull();
  });

  it('no assunto que não exige, vale o motivo; e quem diz que assinou tem de ter a assinatura lá', () => {
    expect(motivoParaNaoFinalizar({ ...base, pedido: { ...base.pedido, semAssinatura: 'Não quis' } })).toBeNull();
    expect(
      motivoParaNaoFinalizar({ ...base, pedido: { ...base.pedido, assinadaPor: 'Maria da Silva' } }),
    ).toMatch(/não está nos arquivos da OS/);
    expect(
      motivoParaNaoFinalizar({
        ...base,
        pedido: { ...base.pedido, assinadaPor: 'Maria', semAssinatura: 'Não quis' },
        assinaturaNaOs: true,
      }),
    ).toMatch(/Ou o cliente assinou, ou não assinou/);
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

  it('o celular não pergunta o diagnóstico: o assunto que o exige se finaliza pelo IXC', () => {
    const exige = { ...assunto, diagnosticoObrigatorio: true };
    expect(motivoDoAssunto(exige)).toMatch(/exige o diagnóstico.*Finalize esta OS pelo IXC/);
    expect(motivoParaNaoFinalizar({ ...base, assunto: exige })).toMatch(/exige o diagnóstico/);
  });

  it('o relatório vazio não passa', () => {
    expect(motivoParaNaoFinalizar({ ...base, pedido: { ...base.pedido, relato: '  ok ' } })).toMatch(
      /relatório/,
    );
  });

  it('a hora em que o serviço começou é opcional', () => {
    expect(motivoParaNaoFinalizar({ ...base, pedido: { ...base.pedido, inicio: null } })).toBeNull();
  });

  it('o início não pode estar no futuro, nem antes da abertura da OS', () => {
    const em = (iso: string) => ({ ...base, pedido: { ...base.pedido, inicio: new Date(iso) } });
    expect(motivoParaNaoFinalizar(em('2026-10-22T13:30:00Z'))).toMatch(/futuro/);
    // Cinco minutos de folga para o relógio do celular.
    expect(motivoParaNaoFinalizar(em('2026-10-22T13:04:00Z'))).toBeNull();
    expect(motivoParaNaoFinalizar(em('2026-10-22T09:59:00Z'))).toMatch(/antes da abertura da OS \(22\/10, 07:00\)/);
    expect(motivoParaNaoFinalizar(em('invalido'))).toMatch(/hora.*não está certa/);
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
