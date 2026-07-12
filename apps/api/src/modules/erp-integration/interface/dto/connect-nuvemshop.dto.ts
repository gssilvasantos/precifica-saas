import { IsString, MinLength } from 'class-validator';

export class ConnectNuvemshopDto {
  @IsString()
  @MinLength(1)
  storeId!: string;

  @IsString()
  @MinLength(10)
  accessToken!: string;
}
