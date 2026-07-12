import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class RecordPackagingUsageDto {
  @IsString()
  productId!: string;

  @IsString()
  packagingId!: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  quantity?: number;
}
