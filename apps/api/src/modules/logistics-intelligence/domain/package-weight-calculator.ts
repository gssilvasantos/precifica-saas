// Cálculo de peso embalado, peso cubado e peso considerado para frete.
// Isolado do resto do módulo de produtos de propósito: essa mesma lógica vai
// ser reaproveitada pelo motor de precificação/frete (próxima etapa) e por
// qualquer reprocessamento em lote — melhor ter um único lugar testado do que
// espalhar a fórmula em vários services.

export interface PackageWeightInput {
  weightKg: number; // peso do produto sem embalagem
  packagingWeightKg: number; // peso da embalagem
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  cubicWeightFactor: number; // divisor de cubagem do tenant (padrão 6000)
}

export interface PackageWeightResult {
  packedWeightKg: number; // peso real embalado
  cubicWeightKg: number; // peso cubado (volumétrico)
  shippingWeightKg: number; // maior dos dois — é o que os marketplaces cobram
}

export function calculatePackageWeights(input: PackageWeightInput): PackageWeightResult {
  if (
    input.weightKg <= 0 ||
    input.lengthCm <= 0 ||
    input.widthCm <= 0 ||
    input.heightCm <= 0 ||
    input.cubicWeightFactor <= 0
  ) {
    throw new Error(
      'Peso e dimensões precisam ser maiores que zero para calcular peso cubado.',
    );
  }

  const packedWeightKg = round(input.weightKg + input.packagingWeightKg);
  const cubicWeightKg = round(
    (input.lengthCm * input.widthCm * input.heightCm) / input.cubicWeightFactor,
  );
  const shippingWeightKg = Math.max(packedWeightKg, cubicWeightKg);

  return { packedWeightKg, cubicWeightKg, shippingWeightKg };
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
