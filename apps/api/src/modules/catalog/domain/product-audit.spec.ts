import { diffGovernanceFields } from './product-audit';

// Domínio puro — sem NestJS, sem Prisma, sem DI. Testa a distinção
// undefined ("campo não tocado") vs null explícito ("limpar o MAP", uma
// mudança real) e a comparação por VALOR (reenviar o mesmo mapPrice não
// gera ruído na auditoria).
describe('diffGovernanceFields', () => {
  const current = { id: 'prod-1', skuCode: 'SKU-001', mapPrice: 50 };

  it('mapPrice ausente no input (undefined): campo não tocado, nenhuma entrada de auditoria', () => {
    const entries = diffGovernanceFields(current, {});
    expect(entries).toEqual([]);
  });

  it('mapPrice reenviado com o MESMO valor: nenhuma entrada (não é uma mudança real)', () => {
    const entries = diffGovernanceFields(current, { mapPrice: 50 });
    expect(entries).toEqual([]);
  });

  it('mapPrice alterado para um valor novo: gera uma entrada com old/new corretos', () => {
    const entries = diffGovernanceFields(current, { mapPrice: 65 });
    expect(entries).toEqual([
      { productId: 'prod-1', skuCode: 'SKU-001', field: 'mapPrice', oldValue: 50, newValue: 65 },
    ]);
  });

  it('mapPrice explicitamente limpo (null): é uma mudança real quando o valor anterior não era null', () => {
    const entries = diffGovernanceFields(current, { mapPrice: null });
    expect(entries).toEqual([
      { productId: 'prod-1', skuCode: 'SKU-001', field: 'mapPrice', oldValue: 50, newValue: null },
    ]);
  });

  it('mapPrice já era null e continua null (explícito): nenhuma mudança real', () => {
    const entries = diffGovernanceFields({ ...current, mapPrice: null }, { mapPrice: null });
    expect(entries).toEqual([]);
  });

  it('produto sem MAP (null) ganha um MAP pela primeira vez: gera entrada oldValue null -> newValue', () => {
    const entries = diffGovernanceFields({ ...current, mapPrice: null }, { mapPrice: 40 });
    expect(entries).toEqual([
      { productId: 'prod-1', skuCode: 'SKU-001', field: 'mapPrice', oldValue: null, newValue: 40 },
    ]);
  });
});
