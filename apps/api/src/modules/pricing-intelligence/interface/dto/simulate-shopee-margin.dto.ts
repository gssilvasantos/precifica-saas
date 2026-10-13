import { IsString, MinLength } from 'class-validator';

export class SimulateShopeeMarginDto {
  @IsString()
  @MinLength(1)
  skuCode!: string;
}
