import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class CreatePackagingDto {
  @IsString()
  name!: string;

  @IsNumber()
  @IsPositive()
  weightG!: number;

  @IsNumber()
  @IsPositive()
  heightCm!: number;

  @IsNumber()
  @IsPositive()
  widthCm!: number;

  @IsNumber()
  @IsPositive()
  lengthCm!: number;

  @IsNumber()
  @IsPositive()
  costPrice!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;
}
