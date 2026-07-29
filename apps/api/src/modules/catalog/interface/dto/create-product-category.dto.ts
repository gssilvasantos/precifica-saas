import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateProductCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  parentCategoryId?: string;
}
