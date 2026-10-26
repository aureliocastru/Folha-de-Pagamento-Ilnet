import {
  dataHoraParaIxc,
  ehAssinatura,
  finalizadaHoje,
  lerArquivoDaOs,
  lerAssunto,
  lerComodato,
  lerOs,
  mensagemDoFechamento,
  montarBaixaDeComodato,
  montarComodatoNaOs,
  montarFechamento,
  montarArquivoNaOs,
  montarMaterialNaOs,
  naOrdemDoTecnico,
  osRecusaMaterial,
  produtoParaOs,
  tipoDoAssunto,
  type Fechamento,
  type OsParaEscrever,
  type ProdutoParaOs,
} from './os-ixc';

/**
 * O que se escreve dentro da OS do IXC. O que este arquivo protege:
 *
 *  - cada corpo leva os obrigatórios da documentação, com o valor certo — o
 *    almoxarifado do técnico como origem, a OS, o contrato, a peça;
 *  - o que falta (contrato, unidade, classificação fiscal) recusa aqui, antes
 *    de ir ao IXC, e não lá, com a mensagem de lá;
 *  - patrimônio não sai como material, e quantidade zero não sai.
 */

const os: OsParaEscrever = {
  osId: 3788,
  contratoId: 2294,
  loginId: 51,
  filialId: 1,
  almoxId: 12,
  dia: '24/09/2026',
};

const onu: ProdutoParaOs = {
  id: 34,
  unidadeId: 1,
  unidadeSigla: 'UND',
  tipo: 'P',
  controlaEstoque: true,
  classificacaoFiscal: 7,
  valorUnitario: 189.9,
  descricao: 'ONU HUAWEI EG8145V5',
};

const conector: ProdutoParaOs = {
  id: 36,
  unidadeId: 2,
  unidadeSigla: 'UN',
  tipo: 'C',
  controlaEstoque: true,
  classificacaoFiscal: 7,
  valorUnitario: 1.25,
  descricao: 'CONECTOR SC/APC',
};

describe('lerOs', () => {
  it('lê a OS com o técnico, o contrato e o endereço juntos', () => {
    const lida = lerOs({
      id: '3788',
      protocolo: '2026092400123',
      status: 'ag',
      prioridade: 'a',
      id_assunto: '4',
      id_cliente: '900',
      id_contrato_kit: '2294',
      id_login: '51',
      id_filial: '1',
      setor: '3',
      id_tecnico: '17',
      data_abertura: '2026-09-23 08:00:00',
      data_agenda: '2026-09-24 09:00:00',
      data_fechamento: '0000-00-00 00:00:00',
      mensagem: 'Trocar ONU queimada',
      endereco: 'Rua das Palmeiras',
      numero: '42',
      bairro: 'Centro',
      complemento: '',
      referencia: 'portão azul',
    });
    expect(lida).toEqual({
      id: 3788,
      protocolo: '2026092400123',
      status: 'AG',
      prioridade: 'A',
      assuntoId: 4,
      clienteId: 900,
      contratoId: 2294,
      loginId: 51,
      filialId: 1,
      setorId: 3,
      tecnicoId: 17,
      abertura: '2026-09-23 08:00:00',
      agenda: '2026-09-24 09:00:00',
      fechamento: null,
      mensagem: 'Trocar ONU queimada',
      endereco: 'Rua das Palmeiras, 42 — Centro — portão azul',
    });
  });

  it('o endereço que já vem montado não repete o bairro', () => {
    expect(
      lerOs({
        id: '92297',
        endereco: 'MA São Mateus do Maranhão 65470-000 Serraria - Rua da Serraria',
        numero: '169',
        bairro: 'Serraria',
        referencia: 'Casa do Mocinho da Van',
      })?.endereco,
    ).toBe('MA São Mateus do Maranhão 65470-000 Serraria - Rua da Serraria, 169 — Casa do Mocinho da Van');
  });

  it('linha sem id não é OS', () => {
    expect(lerOs({ status: 'A' })).toBeNull();
  });

  it('prioridade fora de B, N, A e C fica sem prioridade, e não vira normal', () => {
    expect(lerOs({ id: '1', prioridade: 'C' })?.prioridade).toBe('C');
    expect(lerOs({ id: '1', prioridade: '1' })?.prioridade).toBeNull();
    expect(lerOs({ id: '1' })?.prioridade).toBeNull();
  });
});

describe('tipoDoAssunto', () => {
  it('lê o tipo de serviço pelo nome do assunto, sem ligar para acento e caixa', () => {
    expect(tipoDoAssunto('Cliente sem internet')).toBe('SEM_INTERNET');
    expect(tipoDoAssunto('SEM CONEXÃO')).toBe('SEM_INTERNET');
    expect(tipoDoAssunto('LOS - fibra rompida')).toBe('SEM_INTERNET');
    expect(tipoDoAssunto('Instalação Fibra')).toBe('INSTALACAO');
    expect(tipoDoAssunto('Mudança de endereço')).toBe('MUDANCA_DE_ENDERECO');
    expect(tipoDoAssunto('Troca de Titularidade')).toBe('MUDANCA_DE_TITULARIDADE');
    expect(tipoDoAssunto('Troca de equipamento')).toBe('OUTROS');
    expect(tipoDoAssunto(null)).toBe('OUTROS');
  });

  it('a mudança que fala em instalar é mudança, e não instalação', () => {
    expect(tipoDoAssunto('Instalação - mudança de endereço')).toBe('MUDANCA_DE_ENDERECO');
    expect(tipoDoAssunto('Instalação por mudança de titularidade')).toBe('MUDANCA_DE_TITULARIDADE');
  });

  it('"los" só como palavra: "modelos" não é cliente sem internet', () => {
    expect(tipoDoAssunto('Troca de modelos de ONU')).toBe('OUTROS');
  });
});

describe('naOrdemDoTecnico', () => {
  const os = (
    id: number,
    tipo: Parameters<typeof naOrdemDoTecnico>[0]['tipo'],
    prioridade: 'B' | 'N' | 'A' | 'C' | null,
    agenda: string | null = null,
  ) => ({ id, tipo, prioridade, agenda, abertura: '2026-10-20 08:00:00', recusa: null });

  it('sem internet, instalação, mudança de endereço, de titularidade, e o resto', () => {
    const lista = [
      os(1, 'OUTROS', 'C'),
      os(2, 'MUDANCA_DE_TITULARIDADE', 'N'),
      os(3, 'INSTALACAO', 'N'),
      os(4, 'MUDANCA_DE_ENDERECO', 'N'),
      os(5, 'SEM_INTERNET', 'B'),
    ];
    expect(lista.sort(naOrdemDoTecnico).map((o) => o.id)).toEqual([5, 3, 4, 2, 1]);
  });

  it('no mesmo tipo, a mais urgente primeiro; sem prioridade conta como normal', () => {
    const lista = [
      os(1, 'INSTALACAO', 'B'),
      os(2, 'INSTALACAO', null, '2026-10-22 10:00:00'),
      os(3, 'INSTALACAO', 'C'),
      os(4, 'INSTALACAO', 'N', '2026-10-22 14:00:00'),
      os(5, 'INSTALACAO', 'A'),
    ];
    expect(lista.sort(naOrdemDoTecnico).map((o) => o.id)).toEqual([3, 5, 4, 2, 1]);
  });
});

describe('osRecusaMaterial', () => {
  const base = lerOs({ id: '1', status: 'F', data_fechamento: '2026-09-22 17:00:00' })!;

  it('OS aberta aceita', () => {
    expect(osRecusaMaterial({ ...base, status: 'EX' })).toBeNull();
  });

  it('finalizada há pouco ainda aceita — o técnico lança depois do atendimento fechar', () => {
    expect(osRecusaMaterial(base, new Date('2026-09-24T12:00:00-03:00'))).toBeNull();
  });

  it('finalizada há mais de 3 dias recusa', () => {
    expect(osRecusaMaterial(base, new Date('2026-09-26T18:00:00-03:00'))).toMatch(/mais de 3 dias/);
  });

  it('finalizada sem data recusa', () => {
    expect(osRecusaMaterial({ ...base, fechamento: null })).toMatch(/não diz quando/);
  });
});

describe('finalizadaHoje', () => {
  const base = lerOs({ id: '1', status: 'F', data_fechamento: '2026-09-22 17:00:00' })!;

  it('finalizada hoje aparece — às 23h30 daqui também, com o servidor em UTC já no dia seguinte', () => {
    expect(finalizadaHoje(base, new Date('2026-09-22T23:30:00-03:00'))).toBe(true);
  });

  it('a de ontem não aparece', () => {
    expect(finalizadaHoje(base, new Date('2026-09-23T08:00:00-03:00'))).toBe(false);
    expect(finalizadaHoje({ ...base, fechamento: '2026-09-21 23:59:59' }, new Date('2026-09-22T22:00:00-03:00'))).toBe(false);
  });

  it('aberta ou sem data de fechamento não é finalizada hoje', () => {
    expect(finalizadaHoje({ ...base, status: 'EX' }, new Date('2026-09-22T18:00:00-03:00'))).toBe(false);
    expect(finalizadaHoje({ ...base, fechamento: null }, new Date('2026-09-22T18:00:00-03:00'))).toBe(false);
  });
});

describe('lerComodato', () => {
  it('lê a linha que a baixa vai receber, com a peça', () => {
    expect(
      lerComodato({
        id: '59195',
        id_produto: '34',
        id_patrimonio: '9',
        qtde_saida: '1.000000000',
        mac: 'AA:BB:CC:DD:EE:FF',
        numero_serie: 'HWTC1234',
        numero_patrimonial: 'SAFB0',
        data: '2025-03-10',
        status_comodato: 'e',
      }),
    ).toEqual({
      comodatoId: 59195,
      produtoId: 34,
      descricao: null,
      quantidade: 1,
      patrimonioId: 9,
      numeroPatrimonial: 'SAFB0',
      mac: 'AA:BB:CC:DD:EE:FF',
      numeroSerie: 'HWTC1234',
      desde: '2025-03-10',
      status: 'E',
    });
  });

  it('comodato de produto (sem peça) fica sem patrimônio', () => {
    expect(lerComodato({ id: '1', id_produto: '5', id_patrimonio: '0' })?.patrimonioId).toBeNull();
  });
});

describe('produtoParaOs', () => {
  const unidades = [{ id: 1, sigla: 'UND' }];
  const cadastro = {
    id: '34',
    descricao: 'ONU HUAWEI',
    unidade: '1',
    tipo: 'p',
    controla_estoque: 'S',
    id_class_fiscal: '7',
    preco_base: '189.90',
    ativo: 'S',
  };

  it('lê o que a escrita pede', () => {
    expect(produtoParaOs(cadastro, unidades)).toEqual({
      id: 34,
      unidadeId: 1,
      unidadeSigla: 'UND',
      tipo: 'P',
      controlaEstoque: true,
      classificacaoFiscal: 7,
      valorUnitario: 189.9,
      descricao: 'ONU HUAWEI',
    });
  });

  it('recusa sem unidade, sem classificação fiscal e inativo — o IXC recusaria lá', () => {
    expect(() => produtoParaOs({ ...cadastro, unidade: '9' }, unidades)).toThrow(/sem unidade/);
    expect(() => produtoParaOs({ ...cadastro, id_class_fiscal: '0' }, unidades)).toThrow(
      /classificação fiscal/,
    );
    expect(() => produtoParaOs({ ...cadastro, ativo: 'N' }, unidades)).toThrow(/inativo/);
    expect(() => produtoParaOs(undefined, unidades)).toThrow(/não foi achado/);
  });
});

describe('montarComodatoNaOs', () => {
  const peca = { patrimonioId: 9, numeroPatrimonial: 'SAFB0', mac: 'AA:BB', numeroSerie: 'HW1', situacao: '7' };

  it('igual à linha que o próprio IXC grava: tipo S (saída), e não o "C" da documentação', () => {
    // A linha 1016480 da OS 92279, lida na base em 24/09/2026.
    expect(montarComodatoNaOs(os, onu, peca)).toMatchObject({
      tipo: 'S',
      tipo_produto: 'P',
      garantia_oss: 'N',
      ultima_situacao_patrimonio: '7',
    });
  });

  it('a peça sai do almoxarifado do técnico e fica emprestada no contrato, dentro da OS', () => {
    const corpo = montarComodatoNaOs(os, onu, peca);
    expect(corpo).toMatchObject({
      id_oss_chamado: '3788',
      id_contrato: '2294',
      id_login: '51',
      id_patrimonio: '9',
      id_produto: '34',
      data: '24/09/2026',
      id_unidade: '1',
      id_almox: '12',
      filial_id: '1',
      qtde_saida: '1.00000',
      valor_unitario: '189.90',
      valor_total: '189.90',
      patrimonio: 'SAFB0',
      numero_patrimonial: 'SAFB0',
      mac: 'AA:BB',
      numero_serie: 'HW1',
      id_classificacao_tributaria: '7',
      tipo: 'S',
      estoque: 'S',
      unidade_sigla: 'UND',
      fator_conversao: '1.000000000',
      tipo_produto: 'P',
      status_comodato: 'E',
    });
  });

  it('OS sem login vai com o login vazio, não zero', () => {
    expect(montarComodatoNaOs({ ...os, loginId: 0 }, onu, peca).id_login).toBe('');
  });

  it('sem contrato não há onde pôr o comodato', () => {
    expect(() => montarComodatoNaOs({ ...os, contratoId: 0 }, onu, peca)).toThrow(/contrato/);
  });
});

describe('montarBaixaDeComodato', () => {
  it('manda a peça de volta ao almoxarifado dado, com os rótulos da tela do IXC', () => {
    expect(
      montarBaixaDeComodato({
        comodatoId: 59195,
        almoxId: 12,
        almoxNome: 'VAN CLEYSON',
        filialId: 1,
        filialNome: 'F1',
      }),
    ).toEqual({
      id: '59195',
      id_almox: '12',
      id_almox_label: 'VAN CLEYSON',
      id_filial_baixa: '1',
      id_filial_baixa_label: 'F1',
    });
  });

  it('sem a linha de comodato não baixa', () => {
    expect(() =>
      montarBaixaDeComodato({ comodatoId: 0, almoxId: 12, almoxNome: 'x', filialId: 1 }),
    ).toThrow(/comodato/);
  });
});

describe('montarMaterialNaOs', () => {
  it('o material sai do almoxarifado do técnico pela OS, com o valor da quantidade', () => {
    expect(montarMaterialNaOs(os, conector, 3)).toMatchObject({
      id_oss_chamado: '3788',
      id_patrimonio: '',
      id_produto: '36',
      id_almox: '12',
      qtde_saida: '3.00000',
      valor_unitario: '1.25',
      valor_total: '3.75',
      id_classificacao_tributaria: '7',
      tipo: 'S',
      estoque: 'S',
      unidade_sigla: 'UN',
      tipo_produto: 'C',
      garantia_oss: 'N',
    });
  });

  it('patrimônio não é material, e quantidade zero não sai', () => {
    expect(() => montarMaterialNaOs(os, onu, 1)).toThrow(/patrimônio/);
    expect(() => montarMaterialNaOs(os, conector, 0)).toThrow(/maior que zero/);
  });
});

// ---------------------------------------------------------------------------
// Finalizar a OS
// ---------------------------------------------------------------------------

describe('lerAssunto', () => {
  it('lê do cadastro do IXC o que a finalização pede', () => {
    expect(
      lerAssunto({
        id: '4',
        assunto: 'Instalação FTTH',
        id_resposta_padrao_finalizacao: '12',
        diagnostico_obrigatorio_finalizacao_os: 'S',
        exige_fotos_finalizacao_os: 'S',
        quantidade_fotos_finalizacao_os: '3',
        exige_comodato_finalizar_os: 'S',
        quantidade_equipamentos: '',
        exige_produto_finalizar_os: 'N',
        quantidade_produtos: '5',
        equipe_obrigatoria_finalizacao_os: 'N',
        wiz_assinatura_obrig: 'S',
        valor_comissao: '15.00',
      }),
    ).toEqual({
      id: 4,
      nome: 'Instalação FTTH',
      diagnosticoObrigatorio: true,
      fotosExigidas: 3,
      // "Exige" sem quantidade vale um.
      aparelhosExigidos: 1,
      // A quantidade sem o "exige" não vale nada.
      produtosExigidos: 0,
      equipeObrigatoria: false,
      assinaturaObrigatoria: true,
      geraComissao: true,
    });
  });

  it('o assunto sem nada configurado não exige nada', () => {
    expect(lerAssunto({ id: '7', assunto: 'Visita técnica', id_resposta_padrao_finalizacao: '0' })).toEqual({
      id: 7,
      nome: 'Visita técnica',
      diagnosticoObrigatorio: false,
      fotosExigidas: 0,
      aparelhosExigidos: 0,
      produtosExigidos: 0,
      equipeObrigatoria: false,
      assinaturaObrigatoria: false,
      geraComissao: false,
    });
    expect(lerAssunto({ id: '0' })).toBeNull();
  });
});

describe('montarArquivoNaOs, lerArquivoDaOs e ehAssinatura', () => {
  it('a foto vai para a OS com a descrição que o técnico escreveu, como foto (P)', () => {
    expect(montarArquivoNaOs(3788, '  Caixa CTO, porta 4 ', 'P')).toEqual({
      id_oss_chamado: '3788',
      descricao: 'Caixa CTO, porta 4',
      classificacao_arquivo: 'P',
    });
    expect(montarArquivoNaOs(3788, 'x'.repeat(150), 'P').descricao).toHaveLength(100);
    expect(() => montarArquivoNaOs(0, 'Foto', 'P')).toThrow(/a OS/);
  });

  // As linhas abaixo são como a base devolveu em 23/10/2026 (OS 92948).
  it('lê a linha da aba "Arquivos", e a descrição vazia cai no nome do arquivo', () => {
    expect(
      lerArquivoDaOs({
        classificacao_arquivo: 'P',
        id: '242343',
        descricao: 'Roteador ',
        id_oss_chamado: '92948',
        local_arquivo: 'arquivos/20261023-153615.jpg',
        nome_arquivo: '20261023_153615.jpg',
      }),
    ).toEqual({ id: 242343, osId: 92948, descricao: 'Roteador', classificacao: 'P' });
    expect(
      lerArquivoDaOs({ id: '78', id_oss_chamado: '3788', descricao: '', nome_arquivo: 'IMG-WA0030.jpg' }),
    ).toMatchObject({ descricao: 'IMG-WA0030.jpg', classificacao: null });
    expect(
      lerArquivoDaOs({ id: '79', id_oss_chamado: '3788', local_arquivo: 'arquivos/foto-1.jpg' }),
    ).toMatchObject({ descricao: 'foto-1.jpg' });
    expect(lerArquivoDaOs({ id: '80', id_oss_chamado: '3788' })).toMatchObject({ descricao: 'Arquivo 80' });
    expect(lerArquivoDaOs({ id: '0' })).toBeNull();
  });

  it('reconhece a assinatura do app do IXC (A) e a daqui, mesmo que a classificação não tenha pegado', () => {
    const doIxc = lerArquivoDaOs({
      classificacao_arquivo: 'A',
      id: '242347',
      descricao: 'Assinatura do Cliente',
      id_oss_chamado: '92948',
    })!;
    expect(ehAssinatura(doIxc)).toBe(true);
    expect(ehAssinatura({ descricao: 'Assinatura do Cliente — Maria da Silva', classificacao: 'P' })).toBe(true);
    expect(ehAssinatura({ descricao: 'Roteador', classificacao: 'P' })).toBe(false);
    // O PDF da OS que o IXC gera ao finalizar não é assinatura.
    expect(ehAssinatura({ descricao: 'Ordem de Serviço', classificacao: 'O' })).toBe(false);
  });

  it('a mensagem do fechamento diz quem assinou, ou por que o cliente não assinou', () => {
    expect(mensagemDoFechamento('Troquei a ONU.', 'Cleyson', { assinadaPor: 'Maria', semAssinatura: null })).toBe(
      'Troquei a ONU.\n\nAssinada por Maria — a assinatura está nos arquivos da OS.\n— Finalizada pelo celular por Cleyson.',
    );
    expect(
      mensagemDoFechamento('Troquei a ONU.', 'Cleyson', { assinadaPor: null, semAssinatura: 'Não estava em casa' }),
    ).toBe('Troquei a ONU.\n\nO cliente não assinou: Não estava em casa.\n— Finalizada pelo celular por Cleyson.');
  });
});

describe('montarFechamento', () => {
  const fechamento: Fechamento = {
    osId: 3788,
    tecnicoIxcId: 17,
    // 08:30 e 10:05 no fuso daqui.
    inicio: new Date('2026-10-22T11:30:00Z'),
    fim: new Date('2026-10-22T13:05:09Z'),
    respostaId: 12,
    diagnosticoId: null,
    mensagem: mensagemDoFechamento('Troquei a ONU.  ', 'Cleyson'),
    geraComissao: true,
    gps: { latitude: -12.9714, longitude: -38.5014, em: new Date('2026-10-22T13:04:00Z') },
  };

  it('a data com hora vai no formato de escrita do IXC, no fuso daqui', () => {
    expect(dataHoraParaIxc(new Date('2026-10-22T02:07:03Z'))).toBe('21/10/2026 23:07:03');
  });

  it('fecha a OS com o técnico, as horas, a resposta, a mensagem e o GPS', () => {
    expect(montarFechamento(fechamento)).toMatchObject({
      id_chamado: '3788',
      id_tecnico: '17',
      status: 'F',
      data_inicio: '22/10/2026 08:30:00',
      data_final: '22/10/2026 10:05:09',
      data: '22/10/2026 10:05:09',
      id_resposta: '12',
      id_su_diagnostico: '',
      mensagem: 'Troquei a ONU.\n\n— Finalizada pelo celular por Cleyson.',
      gera_comissao: 'S',
      latitude: '-12.9714000',
      longitude: '-38.5014000',
      gps_time: '22/10/2026 10:04:00',
      // A OS sem processo não leva tarefa.
      id_processo: '',
      id_tarefa_atual: '',
      id_equipe: '',
    });
  });

  it('sem GPS os campos vão vazios, e sem comissão vai "N"', () => {
    expect(montarFechamento({ ...fechamento, gps: null, geraComissao: false })).toMatchObject({
      latitude: '',
      longitude: '',
      gps_time: '',
      gera_comissao: 'N',
    });
  });

  it('recusa aqui o que o IXC recusaria lá', () => {
    expect(() => montarFechamento({ ...fechamento, mensagem: '   ' })).toThrow(/relato/);
    expect(() => montarFechamento({ ...fechamento, fim: new Date('2026-10-22T11:00:00Z') })).toThrow(
      /antes do início/,
    );
    expect(() => montarFechamento({ ...fechamento, tecnicoIxcId: 0 })).toThrow(/técnico/);
  });
});
