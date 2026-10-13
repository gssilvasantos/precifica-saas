import { computeItemTaxAmount } from './tax-amount';

describe('computeItemTaxAmount', () => {
  it('aplica a alíquota em fração sobre o valor do item', () => {
    expect(computeItemTaxAmount(100, 0.073)).toBe(7.3);
  });
  it('arredonda a centavos, inclusive no caso do meio', () => {
    expect(computeItemTaxAmount(10.05, 0.1)).toBe(1.01); // 1,005 -> 1,01
    expect(computeItemTaxAmount(33.33, 0.073)).toBe(2.43); // 2,43309
  });
  it.each([[0, 0.07], [-10, 0.07], [100, 0], [100, -0.1], [NaN, 0.07], [100, Infinity]])(
    'devolve 0 para entrada sem sentido (%p, %p)',
    (price, rate) => expect(computeItemTaxAmount(price as number, rate as number)).toBe(0),
  );
});
