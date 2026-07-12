import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class SimulateNuvemshopMarginDto {
  @IsString()
  @MinLength(1)
  skuCode!: string;

  @IsInt()
  @Min(1)
  installments!: number;

  @IsInt()
  @Min(0)
  receivingWindowDays!: number;

  @IsOptional()
  @IsBoolean()
  freeShipping?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedShippingCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  couponCost?: number;
}
