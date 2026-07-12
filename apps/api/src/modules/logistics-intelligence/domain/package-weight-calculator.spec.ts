import { calculatePackageWeights } from './package-weight-calculator';

describe('calculatePackageWeights', () => {
  it('usa o peso real quando o produto é denso (peso real > peso cubado)', () => {
    // Caixa pequena e pesada: 15x15x15cm, 3kg — peso cubado seria baixo.
    const result = calculatePackageWeights({
      weightKg: 2.9,
      packagingWeightKg: 0.1,
      lengthCm: 15,
      widthCm: 15,
      heightCm: 15,
      cubicWeightFactor: 6000,
    });

    expect(result.packedWeightKg).toBe(3);
    expect(result.cubicWeightKg).toBeCloseTo(0.563, 2);
    expect(result.shippingWeightKg).toBe(3); // peso real vence
  });

  it('usa o peso cubado quando o produto é leve e volumoso (ex.: item de moda em caixa grande)', () => {
    // Caixa grande e leve: 50x40x30cm, 0.5kg — peso cubado deve vencer.
    const result = calculatePackageWeights({
      weightKg: 0.4,
      packagingWeightKg: 0.1,
      lengthCm: 50,
      widthCm: 40,
      heightCm: 30,
      cubicWeightFactor: 6000,
    });

    expect(result.packedWeightKg).toBe(0.5);
    expect(result.cubicWeightKg).toBe(10); // 60000/6000
    expect(result.shippingWeightKg).toBe(10); // peso cubado vence
  });

  it('rejeita peso ou dimensão zero/negativa', () => {
    expect(() =>
      calculatePackageWeights({
        weightKg: 0,
        packagingWeightKg: 0,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 10,
        cubicWeightFactor: 6000,
      }),
    ).toThrow();
  });
});
