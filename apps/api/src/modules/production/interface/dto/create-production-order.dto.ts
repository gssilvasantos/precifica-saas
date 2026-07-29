import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateProductionOrderDto {
  @IsString()
  parentSkuCode!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsString()
  sourceWarehouseId!: string;

  @IsString()
  destinationWarehouseId!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
