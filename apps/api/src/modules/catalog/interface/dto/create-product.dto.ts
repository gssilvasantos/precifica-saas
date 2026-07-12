import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

// Só os campos que o usuário de fato preenche. packedWeightKg, cubicWeightKg
// e shippingWeightKg NÃO entram aqui — são calculados pelo ProductsService
// (ver product-weight.util.ts) e não podem ser sobrescritos pelo cliente.
export class CreateProductDto {
  @IsString()
  skuCode!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  internalCategory?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  taxProfileId?: string;

  // Packaging Intel — vínculo opcional a uma embalagem cadastrada. Quando
  // presente, custo efetivo e peso cubado passam a considerar a embalagem
  // (ver ProductsService.resolvePackaging / CatalogReaderService.findBySku).
  @IsOptional()
  @IsString()
  packagingId?: string;

  @IsNumber()
  @IsPositive()
  costPrice!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  desiredMarginPct!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  minimumMarginPct!: number;

  // Modo operação do PricingStrategist (docs/pricing-intelligence-architecture.md,
  // seção 7) — opt-in por SKU, default false no schema quando omitido.
  @IsOptional()
  @IsBoolean()
  autoRepricingEnabled?: boolean;

  @IsNumber()
  @IsPositive()
  weightKg!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  packagingWeightKg?: number;

  @IsNumber()
  @IsPositive()
  lengthCm!: number;

  @IsNumber()
  @IsPositive()
  widthCm!: number;

  @IsNumber()
  @IsPositive()
  heightCm!: number;
}
