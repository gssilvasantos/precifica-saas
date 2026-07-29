import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class SetCategoryAttributeDto {
  @IsString()
  @MinLength(1)
  attributeName!: string;

  @IsString()
  @MinLength(1)
  attributeValue!: string;

  @IsOptional()
  @IsBoolean()
  extendToChildren?: boolean;
}
