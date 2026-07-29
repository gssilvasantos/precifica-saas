import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsPositive, IsString, ValidateNested } from 'class-validator';

export class ProductStructureComponentDto {
  @IsString()
  componentSkuCode!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;
}

export class SetProductStructureDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductStructureComponentDto)
  components!: ProductStructureComponentDto[];
}
