import { calculateNetMargin, canEnrollInPromotion, InvalidMarginInputsError, MarginInputs } from './margin-calculator';

function buildInputs(overrides: Partial<MarginInputs> = {}): MarginInputs {
  return {
    promotionalPrice: 100,
    costPrice: 40,
    commissionPct: 0.12,
    fixedFeeAmount: 2,
    taxRate: 0.06,
    logisticsCost: 10,
    ...overrides,
  };
}

describe('calculateNetMargin', () => {
  it('calcula VERDE quando a margem líquida é positiva', () => {
    // preço 100, fees = 100*0.12+2 = 14, tax = 6, custo 40, logística 10
    // margem = 100 - 14 - 6 - 40 - 10 = 30 -> 30%
    const result = calculateNetMargin(buildInputs());
    expect(result.feesAmount).toBeCloseTo(14);
    expect(result.taxAmount).toBeCloseTo(6);
    expect(result.netMarginAmount).toBeCloseTo(30);
    expect(result.netMarginPct).toBeCloseTo(30);
    expect(result.marginStatus).toBe('VERDE');
  });

  it('calcula VERMELHO quando a margem líquida é negativa', () => {
    const result = calculateNetMargin(buildInputs({ costPrice: 90 }));
    expect(result.netMarginAmount).toBeLessThan(0);
    expect(result.marginStatus).toBe('VERMELHO');
  });

  it('trata margem exatamente zero como VERMELHO (defensivo, nunca um terceiro estado)', () => {
    // fees=14, tax=6, custo+logistica = 80 -> margem = 100-14-6-80 = 0
    const result = calculateNetMargin(buildInputs({ costPrice: 70, logisticsCost: 10 }));
    expect(result.netMarginAmount).toBe(0);
    expect(result.marginStatus).toBe('VERMELHO');
  });

  it('rejeita promotionalPrice <= 0', () => {
    expect(() => calculateNetMargin(buildInputs({ promotionalPrice: 0 }))).toThrow(InvalidMarginInputsError);
    expect(() => calculateNetMargin(buildInputs({ promotionalPrice: -10 }))).toThrow(InvalidMarginInputsError);
  });

  it('logisticsCost mais alto reduz a margem líquida proporcionalmente', () => {
    const baseline = calculateNetMargin(buildInputs({ logisticsCost: 10 }));
    const withHigherLogistics = calculateNetMargin(buildInputs({ logisticsCost: 25 }));
    expect(withHigherLogistics.netMarginAmount).toBeCloseTo(baseline.netMarginAmount - 15);
  });
});

describe('canEnrollInPromotion', () => {
  it('permite adesão quando VERDE', () => {
    const gate = canEnrollInPromotion(calculateNetMargin(buildInputs()));
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBeNull();
  });

  it('bloqueia adesão quando VERMELHO, com motivo explicativo', () => {
    const gate = canEnrollInPromotion(calculateNetMargin(buildInputs({ costPrice: 200 })));
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('bloqueada');
  });
});
