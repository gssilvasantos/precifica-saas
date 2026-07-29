import { isValidAdjustmentPct, isValidName, isValidOverridePrice, resolveListPrice } from './price-list.entity';

describe('isValidName', () => {
  it('rejeita vazio/só espaços', () => {
    expect(isValidName('')).toBe(false);
    expect(isValidName('   ')).toBe(false);
  });

  it('rejeita nome maior que 100 caracteres', () => {
    expect(isValidName('a'.repeat(101))).toBe(false);
  });

  it('aceita nome válido', () => {
    expect(isValidName('Atacado')).toBe(true);
  });
});

describe('isValidAdjustmentPct', () => {
  it('rejeita não finito', () => {
    expect(isValidAdjustmentPct(NaN)).toBe(false);
    expect(isValidAdjustmentPct(Infinity)).toBe(false);
  });

  it('rejeita -100 (zeraria o preço) e valores menores', () => {
    expect(isValidAdjustmentPct(-100)).toBe(false);
    expect(isValidAdjustmentPct(-150)).toBe(false);
  });

  it('aceita desconto válido (negativo, acima de -100)', () => {
    expect(isValidAdjustmentPct(-10)).toBe(true);
    expect(isValidAdjustmentPct(-99)).toBe(true);
  });

  it('aceita acréscimo dentro do teto', () => {
    expect(isValidAdjustmentPct(10)).toBe(true);
    expect(isValidAdjustmentPct(1000)).toBe(true);
  });

  it('rejeita acima do teto de 1000', () => {
    expect(isValidAdjustmentPct(1001)).toBe(false);
  });

  it('aceita zero (lista sem ajuste, só exceções)', () => {
    expect(isValidAdjustmentPct(0)).toBe(true);
  });
});

describe('isValidOverridePrice', () => {
  it('rejeita zero e negativo', () => {
    expect(isValidOverridePrice(0)).toBe(false);
    expect(isValidOverridePrice(-10)).toBe(false);
  });

  it('rejeita não finito', () => {
    expect(isValidOverridePrice(NaN)).toBe(false);
  });

  it('aceita positivo', () => {
    expect(isValidOverridePrice(49.9)).toBe(true);
  });
});

describe('resolveListPrice', () => {
  it('aplica acréscimo percentual sobre o basePrice', () => {
    expect(resolveListPrice(100, 10)).toBe(110);
  });

  it('aplica desconto percentual sobre o basePrice', () => {
    expect(resolveListPrice(100, -20)).toBe(80);
  });

  it('sem ajuste (0%) retorna o basePrice intacto', () => {
    expect(resolveListPrice(100, 0)).toBe(100);
  });

  it('exceção SEMPRE vence sobre o percentual da lista', () => {
    expect(resolveListPrice(100, 10, 55)).toBe(55);
  });

  it('exceção null/undefined não interfere no cálculo percentual', () => {
    expect(resolveListPrice(100, 10, null)).toBe(110);
    expect(resolveListPrice(100, 10, undefined)).toBe(110);
  });
});
