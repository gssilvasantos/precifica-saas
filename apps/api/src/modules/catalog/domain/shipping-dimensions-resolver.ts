import { PackageWeightInput } from '../../../shared/contracts/shipping-weight-calculator.port';

// Função pura, sem I/O — decide QUAL fonte de dimensões/peso de embalagem
// alimenta o ShippingWeightCalculator (Logistics Intelligence): a embalagem
// cadastrada (Packaging), quando vinculada ao produto, ou os campos manuais
// do próprio produto, quando não. O peso do PRODUTO em si (productWeightKg)
// nunca muda — só a parte "embalagem" da conta.
//
// Fica no Catalog (não no Logistics Intelligence) porque é uma decisão de
// "de onde vem o dado", não de "como calcular peso cubado" — a fórmula em
// si continua 100% desconhecida daqui, delegada à porta ShippingWeightCalculator
// como sempre foi (docs/platform-architecture.md, seção 10.1).
export interface ProductPhysicalDefaults {
  weightKg: number;
  packagingWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface PackagingDimensions {
  weightG: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export function resolveShippingDimensions(
  product: ProductPhysicalDefaults,
  packaging: PackagingDimensions | null,
): PackageWeightInput {
  if (!packaging) {
    return {
      weightKg: product.weightKg,
      packagingWeightKg: product.packagingWeightKg,
      lengthCm: product.lengthCm,
      widthCm: product.widthCm,
      heightCm: product.heightCm,
    };
  }

  return {
    weightKg: product.weightKg, // o produto em si nunca some da conta
    packagingWeightKg: packaging.weightG / 1000, // Packaging é cadastrada em gramas — conversão na borda
    lengthCm: packaging.lengthCm,
    widthCm: packaging.widthCm,
    heightCm: packaging.heightCm,
  };
}
