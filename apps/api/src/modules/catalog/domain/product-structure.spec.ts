import { isValidComponents, resolveComponentRequirements } from './product-structure';

describe('isValidComponents', () => {
  it('rejeita lista vazia', () => {
    expect(isValidComponents('KIT-1', [])).toBe(false);
  });

  it('aceita uma lista válida com múltiplos componentes', () => {
    expect(
      isValidComponents('KIT-1', [
        { componentSkuCode: 'COMP-1', quantity: 2 },
        { componentSkuCode: 'COMP-2', quantity: 1 },
      ]),
    ).toBe(true);
  });

  it('aceita quantidade fracionária', () => {
    expect(isValidComponents('KIT-1', [{ componentSkuCode: 'COMP-1', quantity: 0.5 }])).toBe(true);
  });

  it('rejeita componentSkuCode vazio', () => {
    expect(isValidComponents('KIT-1', [{ componentSkuCode: '', quantity: 1 }])).toBe(false);
  });

  it('rejeita quantidade zero ou negativa', () => {
    expect(isValidComponents('KIT-1', [{ componentSkuCode: 'COMP-1', quantity: 0 }])).toBe(false);
    expect(isValidComponents('KIT-1', [{ componentSkuCode: 'COMP-1', quantity: -1 }])).toBe(false);
  });

  it('rejeita o kit compondo a si mesmo', () => {
    expect(isValidComponents('KIT-1', [{ componentSkuCode: 'KIT-1', quantity: 1 }])).toBe(false);
  });

  it('rejeita componente duplicado', () => {
    expect(
      isValidComponents('KIT-1', [
        { componentSkuCode: 'COMP-1', quantity: 1 },
        { componentSkuCode: 'COMP-1', quantity: 2 },
      ]),
    ).toBe(false);
  });
});

describe('resolveComponentRequirements', () => {
  it('multiplica quantityPerUnit pela quantidade a produzir', () => {
    const result = resolveComponentRequirements(
      [
        { componentSkuCode: 'COMP-1', quantity: 2 },
        { componentSkuCode: 'COMP-2', quantity: 0.5 },
      ],
      3,
    );

    expect(result).toEqual([
      { componentSkuCode: 'COMP-1', quantityPerUnit: 2, totalQuantity: 6 },
      { componentSkuCode: 'COMP-2', quantityPerUnit: 0.5, totalQuantity: 1.5 },
    ]);
  });

  it('lista vazia devolve lista vazia', () => {
    expect(resolveComponentRequirements([], 5)).toEqual([]);
  });
});
