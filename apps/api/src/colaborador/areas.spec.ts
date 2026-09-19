import { transfereEntreAlmoxarifados } from './areas';

describe('transfereEntreAlmoxarifados', () => {
  it('o coordenador transfere — a mesma marca que o deixa pontuar', () => {
    expect(transfereEntreAlmoxarifados({ role: 'RH', minhaArea: ['pontuacao', 'pontuar'] })).toBe(true);
  });

  it('o almoxarife, que mexe no módulo mas não coordena, não transfere', () => {
    expect(transfereEntreAlmoxarifados({ role: 'RH', minhaArea: ['pontuacao', 'abastecimento'] })).toBe(
      false,
    );
    expect(transfereEntreAlmoxarifados({ role: 'RH', minhaArea: [] })).toBe(false);
    expect(transfereEntreAlmoxarifados({ role: 'RH' })).toBe(false);
  });

  it('o ADMIN transfere sempre, marcado ou não', () => {
    expect(transfereEntreAlmoxarifados({ role: 'ADMIN', minhaArea: [] })).toBe(true);
  });

  it('sem login, não', () => {
    expect(transfereEntreAlmoxarifados(undefined)).toBe(false);
  });
});
