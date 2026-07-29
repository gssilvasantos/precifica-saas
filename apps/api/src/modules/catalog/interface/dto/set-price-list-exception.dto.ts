import { IsNumber, IsPositive, IsString } from 'class-validator';

export class SetPriceListExceptionDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  overridePrice!: number;
}
