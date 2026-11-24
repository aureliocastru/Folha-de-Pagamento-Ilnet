import { aprDaOs, osPedeApr, travaDaApr, type AprGuardada } from './apr-da-os';
import { descricaoDaAprNaOs, ehAprDaOs } from './os-ixc';

/**
 * A APR que vem com a OS (pedido de 24/11/2026). O que este arquivo protege:
 *
 *  - toda OS do técnico pede APR, menos as de escritório que já ficam fora da
 *    conferência;
 *  - a OS só fecha com a APR liberada e já nos arquivos do IXC — a liberada
 *    que não chegou lá ainda trava;
 *  - a cancelada não vale: a OS volta a "falta preencher";
 *  - o PDF da APR nos arquivos da OS se reconhece pela descrição.
 */

const LIBERADA: AprGuardada = {
  id: 'apr1',
  numero: 31,
  status: 'LIBERADA',
  criadoPorId: 'u1',
  criadoPorNome: 'Cleyson',
  arquivoNaOsIxcId: 4401,
  arquivoNaOsErro: null,
};

describe('osPedeApr', () => {
  it('toda OS de campo pede, e as de escritório não', () => {
    for (const nome of ['Inst Fibra', 'RETIRADA DE EQUIPAMENTO', 'Suporte Técnico', null]) {
      expect(osPedeApr(nome)).toBe(true);
    }
    for (const nome of ['PÓS VENDA', 'Conferencia de contrato e Gerar financeiro']) {
      expect(osPedeApr(nome)).toBe(false);
    }
  });
});

describe('travaDaApr', () => {
  it('sem APR, ou com ela cancelada, falta a análise', () => {
    expect(travaDaApr(null)).toMatch(/Falta a análise de risco/);
    expect(travaDaApr({ ...LIBERADA, status: 'CANCELADA' })).toMatch(/Falta a análise de risco/);
  });

  it('em preenchimento, falta liberar', () => {
    expect(travaDaApr({ ...LIBERADA, status: 'RASCUNHO', arquivoNaOsIxcId: null })).toMatch(
      /APR nº 31.*não foi liberada/,
    );
  });

  it('liberada e fora dos arquivos da OS, ainda trava', () => {
    expect(travaDaApr({ ...LIBERADA, arquivoNaOsIxcId: null })).toMatch(/não chegou aos arquivos da OS/);
  });

  it('liberada e nos arquivos da OS, deixa finalizar', () => {
    expect(travaDaApr(LIBERADA)).toBeNull();
  });
});

describe('aprDaOs', () => {
  it('a que ninguém começou', () => {
    expect(aprDaOs(null, 'u1')).toEqual({
      situacao: 'FALTA',
      id: null,
      numero: null,
      naOs: false,
      erro: null,
      deOutro: null,
      trava: expect.stringMatching(/Falta a análise de risco/),
    });
  });

  it('a liberada que o IXC recusou mostra o motivo, e a que chegou não', () => {
    const recusada = aprDaOs({ ...LIBERADA, arquivoNaOsIxcId: null, arquivoNaOsErro: 'IXC fora do ar' }, 'u1');
    expect(recusada).toMatchObject({ situacao: 'LIBERADA', naOs: false, erro: 'IXC fora do ar' });
    expect(aprDaOs({ ...LIBERADA, arquivoNaOsErro: 'velho' }, 'u1')).toMatchObject({ naOs: true, erro: null, trava: null });
  });

  it('diz quem abriu quando a OS mudou de mãos', () => {
    expect(aprDaOs(LIBERADA, 'u2').deOutro).toBe('Cleyson');
    expect(aprDaOs(LIBERADA, 'u1').deOutro).toBeNull();
  });
});

describe('o PDF da APR nos arquivos da OS', () => {
  it('se reconhece pela descrição', () => {
    expect(ehAprDaOs({ descricao: descricaoDaAprNaOs(31) })).toBe(true);
    expect(ehAprDaOs({ descricao: 'Sinal na ONU' })).toBe(false);
    expect(ehAprDaOs({ descricao: 'Assinatura do Cliente — Maria' })).toBe(false);
  });
});
