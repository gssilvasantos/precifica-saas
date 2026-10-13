import { calculateMarketplaceFeeMarginScenario, InvalidMarginScenarioError } from './marketplace-fee-margin-calculator';

describe('calculateMarketplaceFeeMarginScenario', () => {
  it('calcula margem líquida deduzindo a taxa do canal já resolvida', () => {
    const result = calculateMarketplaceFeeMarginScenario({ grossPrice: 100, costPrice: 60, totalFeeAmount: 14 });

    expect(result.feeAmount).toBe(14);
    expect(result.netRevenue).toBe(86);
    expect(result.netMargin).toBe(26);
    expect(result.netMarginPct).toBe(26);
  });

  it('taxa zero (sem regra encontrada) não distorce o resultado — margem é só preço menos custo', () => {
    const result = calculateMarketplaceFeeMarginScenario({ grossPrice: 100, costPrice: 60, totalFeeAmount: 0 });

    expect(result.feeAmount).toBe(0);
    expect(result.netMargin).toBe(40);
  });

  it('rejeita preço de venda zero ou negativo', () => {
    expect(() => calculateMarketplaceFeeMarginScenario({ grossPrice: 0, costPrice: 10, totalFeeAmount: 0 })).toThrow(
      InvalidMarginScenarioError,
    );
    expect(() => calculateMarketplaceFeeMarginScenario({ grossPrice: -5, costPrice: 10, totalFeeAmount: 0 })).toThrow(
      InvalidMarginScenarioError,
    );
  });

  it('rejeita custo negativo', () => {
    expect(() => calculateMarketplaceFeeMarginScenario({ grossPrice: 100, costPrice: -1, totalFeeAmount: 0 })).toThrow(
      InvalidMarginScenarioError,
    );
  });

  it('rejeita taxa do canal negativa', () => {
    expect(() => calculateMarketplaceFeeMarginScenario({ grossPrice: 100, costPrice: 10, totalFeeAmount: -1 })).toThrow(
      InvalidMarginScenarioError,
    );
  });

  it('arredonda a margem percentual para 2 casas decimais (dízima)', () => {
    // netMargin = 1, grossPrice = 3 -> 33,333...% -> arredonda pra 33.33
    const result = calculateMarketplaceFeeMarginScenario({ grossPrice: 3, costPrice: 2, totalFeeAmount: 0 });

    expect(result.netMargin).toBe(1);
    expect(result.netMarginPct).toBe(33.33);
  });

  it('margem negativa é um resultado válido — não lança, só reporta', () => {
    const result = calculateMarketplaceFeeMarginScenario({ grossPrice: 20, costPrice: 25, totalFeeAmount: 4 });

    expect(result.netMargin).toBeLessThan(0);
  });
});
