import { IsDateString, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateReceivableDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsDateString()
  expectedDate!: string;

  @IsString()
  marketplaceSource!: string;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsString()
  skuCode?: string;
}
