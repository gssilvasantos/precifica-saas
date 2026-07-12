export interface PackageWeightInput {
  weightKg: number;
  packagingWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface PackageWeightResult {
  packedWeightKg: number;
  cubicWeightKg: number;
  shippingWeightKg: number;
}

// Porta que o Catalog consome e o Logistics Intelligence implementa (ver
// docs/platform-architecture.md, seção 10.1). O Catalog nunca conhece a
// fórmula de cubagem nem o fator configurável — só pede "calcule para mim".
export interface ShippingWeightCalculator {
  calculate(tenantId: string, input: PackageWeightInput): Promise<PackageWeightResult>;
}
