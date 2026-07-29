import { IsInt, IsNumber, IsObject, IsOptional, IsPositive, IsString, Min, MinLength } from 'class-validator';

export class PublishListingDto {
  @IsString()
  @MinLength(1)
  skuCode!: string;

  @IsString()
  @MinLength(1)
  marketplaceCode!: string;

  @IsNumber()
  @IsPositive()
  price!: number;

  @IsInt()
  @Min(0)
  availableQuantity!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  // Sobrescreve/complementa os atributos herdados da categoria interna — ex.:
  // "Cor" varia por produto mesmo dentro da mesma categoria.
  @IsOptional()
  @IsObject()
  overrideAttributes?: Record<string, string>;
}
