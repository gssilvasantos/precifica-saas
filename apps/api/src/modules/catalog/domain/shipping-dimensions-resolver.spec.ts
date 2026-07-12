import { resolveShippingDimensions } from './shipping-dimensions-resolver';

describe('resolveShippingDimensions', () => {
  const product = {
    weightKg: 1.2,
    packagingWeightKg: 0.1,
    lengthCm: 20,
    widthCm: 15,
    heightCm: 10,
  };

  it('sem embalagem vinculada: usa os campos manuais do próprio produto (passthrough)', () => {
    const result = resolveShippingDimensions(product, null);

    expect(result).toEqual({
      weightKg: 1.2,
      packagingWeightKg: 0.1,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
    });
  });

  it('com embalagem vinculada: dimensões/peso de embalagem da Packaging sobrepõem os do produto', () => {
    const packaging = { weightG: 250, lengthCm: 30, widthCm: 25, heightCm: 12 };

    const result = resolveShippingDimensions(product, packaging);

    expect(result.lengthCm).toBe(30);
    expect(result.widthCm).toBe(25);
    expect(result.heightCm).toBe(12);
    // conversão de gramas para Kg acontece aqui, na borda
    expect(result.packagingWeightKg).toBeCloseTo(0.25, 5);
  });

  it('com embalagem vinculada: o peso do PRODUTO em si nunca é substituído', () => {
    const packaging = { weightG: 250, lengthCm: 30, widthCm: 25, heightCm: 12 };

    const result = resolveShippingDimensions(product, packaging);

    expect(result.weightKg).toBe(product.weightKg);
  });

  it('converte gramas para Kg corretamente para valores não redondos', () => {
    const packaging = { weightG: 37, lengthCm: 10, widthCm: 10, heightCm: 10 };

    const result = resolveShippingDimensions(product, packaging);

    expect(result.packagingWeightKg).toBeCloseTo(0.037, 5);
  });
});
