import { IsString, MinLength } from 'class-validator';

export class SetChannelCategoryMappingDto {
  @IsString()
  @MinLength(1)
  categoryId!: string;

  @IsString()
  @MinLength(1)
  marketplaceCode!: string;

  @IsString()
  @MinLength(1)
  externalCategoryId!: string;

  @IsString()
  @MinLength(1)
  externalCategoryName!: string;
}
