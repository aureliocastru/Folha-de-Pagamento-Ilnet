import {
  ehDia,
  ehInstalacao,
  ehRetirada,
  gpsDoFechamento,
  lerAparelhoDaOs,
  lerMaterialDaOs,
  lerOsFechada,
  motivoParaRecusarVeredito,
  pesoDosSinais,
  resumirConferencias,
  sinaisDaOs,
  situacaoDepois,
  somarDias,
  type DadosParaSinais,
} from './conferencia';
import type { ArquivoDaOs, ComodatoDoContrato } from './os-ixc';

/**
 * A conferência das OS fechadas. O que este arquivo protege:
 *
 *  - a leitura do que o IXC devolve numa OS fechada — as linhas daqui são as
 *    que a base devolveu em 23/10/2026 (OS 93391, 93250);
 *  - os avisos: o que é problema, o que é só atenção, e o que não é nada;
 *  - o veredito: problema pede motivo, e "conferida" depois do problema é
 *    problema resolvido, que o relatório não conta como de primeira.
 */

describe('lerOsFechada', () => {
  it('traz o relatório do técnico', () => {
    const os = lerOsFechada({
      id: '93391',
      status: 'F',
      id_assunto: '33',
      id_cliente: '11570',
      id_contrato_kit: '13235',
      id_tecnico: '57',
      data_fechamento: '2026-10-23 08:35:26',
      mensagem_resposta: 'Retirada\r\nFeito a retirada da HG',
    })!;
    expect(os).toMatchObject({
      id: 93391,
      tecnicoId: 57,
      contratoId: 13235,
      fechamento: '2026-10-23 08:35:26',
      relatorio: 'Retirada\r\nFeito a retirada da HG',
    });
  });
});

describe('lerAparelhoDaOs e lerMaterialDaOs', () => {
  it('lê a linha de comodato da OS, com a peça e o contrato', () => {
    expect(
      lerAparelhoDaOs({
        id: '1025271',
        tipo_produto: 'P',
        id_oss_chamado: '93250',
        id_produto: '1771',
        tipo: 'S',
        id_patrimonio: '30770',
        descricao: 'ROTEADOR HUAWEI AX3000 ONT',
        id_contrato: '18161',
        status_comodato: 'D',
        numero_patrimonial: '37230',
        numero_serie: '485754439DE5A4B6',
      }),
    ).toEqual({
      id: 1025271,
      produtoId: 1771,
      descricao: 'ROTEADOR HUAWEI AX3000 ONT',
      patrimonioId: 30770,
      numeroPatrimonial: '37230',
      numeroSerie: '485754439DE5A4B6',
      mac: null,
      contratoId: 18161,
      status: 'D',
    });
  });

  it('o material deixa o comodato (P) de fora', () => {
    expect(lerMaterialDaOs({ id: '1', id_produto: '9', tipo_produto: 'P' })).toBeNull();
    expect(
      lerMaterialDaOs({ id: '2', id_produto: '40', descricao: 'CONECTOR SC/APC', qtde_saida: '2.000', unidade_sigla: 'UND' }),
    ).toEqual({ id: 2, produtoId: 40, descricao: 'CONECTOR SC/APC', quantidade: 2, unidade: 'UND' });
  });
});

describe('gpsDoFechamento', () => {
  it('pega o GPS da mensagem de fechamento (status F)', () => {
    const mensagens = [
      { status: 'A', mensagem: 'Processo' },
      { status: 'EN', mensagem: 'encaminhou' },
      { status: 'F', latitude: '-4.059609420713618', longitude: '-44.46069235554803', gps_time: '2026-10-23 08:33:10' },
    ];
    expect(gpsDoFechamento(mensagens)).toEqual({
      latitude: -4.059609420713618,
      longitude: -44.46069235554803,
      em: '2026-10-23 08:33:10',
    });
    expect(gpsDoFechamento([{ status: 'F', latitude: '', longitude: '' }])).toBeNull();
    expect(gpsDoFechamento([{ status: 'F', latitude: '0', longitude: '0' }])).toBeNull();
  });
});

describe('o tipo de serviço, pelo nome do assunto da base', () => {
  it('reconhece a instalação, e não o aplicativo', () => {
    for (const nome of ['Inst Fibra', 'Instalação', 'NOVA INSTALAÇÃO RÁDIO', 'Migração', 'Inst Radio']) {
      expect(ehInstalacao(nome)).toBe(true);
    }
    for (const nome of ['Inst Aplicativo', 'Suporte Técnico', 'Cliente Sem Internet', null]) {
      expect(ehInstalacao(nome)).toBe(false);
    }
  });

  it('reconhece a retirada de equipamento, e não a de cabo', () => {
    expect(ehRetirada('RETIRADA DE EQUIPAMENTO')).toBe(true);
    expect(ehRetirada('Retirada de Cabo')).toBe(false);
  });
});

describe('sinaisDaOs', () => {
  const foto = (id: number, descricao = 'Roteador'): ArquivoDaOs => ({ id, osId: 1, descricao, classificacao: 'P' });
  const assinatura: ArquivoDaOs = { id: 9, osId: 1, descricao: 'Assinatura do Cliente', classificacao: 'A' };
  const pdf: ArquivoDaOs = { id: 8, osId: 1, descricao: 'Ordem de Serviço', classificacao: 'O' };
  const onu = {
    id: 1,
    produtoId: 727,
    descricao: 'ONU FIBER HOME',
    patrimonioId: 8372,
    numeroPatrimonial: '16328',
    numeroSerie: 'FHTT9566C878',
    mac: null,
    contratoId: 9369,
    status: 'E',
  };
  const base: DadosParaSinais = {
    nomeDoAssunto: 'Suporte Técnico',
    assunto: { fotosExigidas: 0, assinaturaObrigatoria: false, aparelhosExigidos: 0 },
    contratoId: 9369,
    arquivos: [foto(1)],
    aparelhos: [],
    comodatoDoContrato: null,
    itensForaDoIxc: 0,
  };
  const codigos = (d: Partial<DadosParaSinais>) => sinaisDaOs({ ...base, ...d }).map((s) => `${s.codigo}:${s.gravidade}`);

  it('a OS certa não tem aviso', () => {
    expect(codigos({})).toEqual([]);
    expect(pesoDosSinais([])).toBe(2);
  });

  it('sem foto é atenção; problema quando o assunto exige', () => {
    // A assinatura e o PDF da OS não são foto.
    expect(codigos({ arquivos: [assinatura, pdf] })).toEqual(['SEM_FOTO:ATENCAO']);
    expect(codigos({ arquivos: [], assunto: { ...base.assunto!, fotosExigidas: 2 } })).toEqual(['SEM_FOTO:PROBLEMA']);
    expect(codigos({ assunto: { ...base.assunto!, fotosExigidas: 2 } })).toEqual(['FOTOS_A_MENOS:PROBLEMA']);
  });

  it('sem assinatura, quando o assunto exige', () => {
    const exige = { ...base.assunto!, assinaturaObrigatoria: true };
    expect(codigos({ assunto: exige })).toEqual(['SEM_ASSINATURA:PROBLEMA']);
    expect(codigos({ assunto: exige, arquivos: [foto(1), assinatura] })).toEqual([]);
  });

  it('instalação sem aparelho em comodato na OS', () => {
    expect(codigos({ nomeDoAssunto: 'Inst Fibra' })).toEqual(['SEM_APARELHO:PROBLEMA']);
    expect(codigos({ nomeDoAssunto: 'Inst Fibra', aparelhos: [onu] })).toEqual([]);
    // O aparelho devolvido na própria OS não conta como instalado.
    expect(codigos({ nomeDoAssunto: 'Inst Fibra', aparelhos: [{ ...onu, status: 'D' }] })).toEqual([
      'SEM_APARELHO:PROBLEMA',
    ]);
  });

  it('aparelho que foi para outro contrato', () => {
    const sinais = sinaisDaOs({ ...base, aparelhos: [{ ...onu, contratoId: 18161 }] });
    expect(sinais).toEqual([
      expect.objectContaining({ codigo: 'APARELHO_EM_OUTRO_CONTRATO', gravidade: 'PROBLEMA' }),
    ]);
    expect(sinais[0].texto).toMatch(/contrato 18161, e a OS é do 9369/);
  });

  it('retirada com aparelho ainda emprestado no contrato', () => {
    const emprestado = { comodatoId: 5, status: 'E' } as ComodatoDoContrato;
    expect(codigos({ nomeDoAssunto: 'RETIRADA DE EQUIPAMENTO', comodatoDoContrato: [emprestado] })).toEqual([
      'RETIRADA_NAO_BAIXADA:PROBLEMA',
    ]);
    expect(codigos({ nomeDoAssunto: 'RETIRADA DE EQUIPAMENTO', comodatoDoContrato: [] })).toEqual([]);
  });

  it('itens do celular fora do IXC', () => {
    expect(codigos({ itensForaDoIxc: 2 })).toEqual(['ITENS_DO_APP:PROBLEMA']);
  });

  it('os problemas vêm antes da atenção', () => {
    // A falta de foto é achada primeiro, mas a instalação sem aparelho é mais grave.
    const sinais = sinaisDaOs({ ...base, arquivos: [], nomeDoAssunto: 'Inst Fibra' });
    expect(sinais.map((s) => `${s.codigo}:${s.gravidade}`)).toEqual(['SEM_APARELHO:PROBLEMA', 'SEM_FOTO:ATENCAO']);
    expect(pesoDosSinais(sinais)).toBe(0);
    expect(pesoDosSinais(sinais.slice(1))).toBe(1);
  });
});

describe('o veredito', () => {
  it('problema pede motivo, e "outro motivo" pede a observação', () => {
    expect(motivoParaRecusarVeredito({ situacao: 'CONFERIDA' })).toBeNull();
    expect(motivoParaRecusarVeredito({ situacao: 'PROBLEMA' })).toMatch(/motivo/);
    expect(motivoParaRecusarVeredito({ situacao: 'PROBLEMA', motivo: 'INVENTADO' })).toMatch(/motivo/);
    expect(motivoParaRecusarVeredito({ situacao: 'PROBLEMA', motivo: 'FALTOU_FOTO' })).toBeNull();
    expect(motivoParaRecusarVeredito({ situacao: 'PROBLEMA', motivo: 'OUTRO', observacao: ' ' })).toMatch(
      /observação/,
    );
  });

  it('"conferida" depois do problema é problema resolvido', () => {
    expect(situacaoDepois(null, 'CONFERIDA')).toEqual({ situacao: 'CONFERIDA', teveProblema: false });
    expect(situacaoDepois(null, 'PROBLEMA')).toEqual({ situacao: 'PROBLEMA', teveProblema: true });
    expect(situacaoDepois({ situacao: 'PROBLEMA', teveProblema: true }, 'CONFERIDA')).toEqual({
      situacao: 'RESOLVIDA',
      teveProblema: true,
    });
  });
});

describe('resumirConferencias', () => {
  it('conta por técnico, o "de primeira" e os motivos', () => {
    const r = resumirConferencias('2026-10', [
      { tecnicoIxcId: 57, tecnico: 'Cleyson', situacao: 'CONFERIDA', teveProblema: false, motivo: null },
      { tecnicoIxcId: 57, tecnico: 'Cleyson', situacao: 'RESOLVIDA', teveProblema: true, motivo: 'FALTOU_FOTO' },
      { tecnicoIxcId: 57, tecnico: 'Cleyson', situacao: 'PROBLEMA', teveProblema: true, motivo: 'FALTOU_FOTO' },
      { tecnicoIxcId: 81, tecnico: 'Rafael', situacao: 'CONFERIDA', teveProblema: false, motivo: null },
    ]);
    expect(r).toMatchObject({ conferidas: 4, dePrimeira: 2, comProblema: 2, abertas: 1 });
    expect(r.porTecnico).toEqual([
      expect.objectContaining({ tecnico: 'Cleyson', conferidas: 3, dePrimeira: 1, abertas: 1, pctDePrimeira: 33 }),
      expect.objectContaining({ tecnico: 'Rafael', conferidas: 1, pctDePrimeira: 100 }),
    ]);
    expect(r.motivos).toEqual([
      { motivo: 'FALTOU_FOTO', texto: 'Faltou foto, ou a foto não mostra o serviço', vezes: 2 },
    ]);
  });
});

describe('os dias', () => {
  it('confere o formato e anda no calendário', () => {
    expect(ehDia('2026-10-23')).toBe(true);
    expect(ehDia('2026-02-30')).toBe(false);
    expect(ehDia('23/10/2026')).toBe(false);
    expect(somarDias('2026-10-01', -1)).toBe('2026-09-30');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
  });
});
