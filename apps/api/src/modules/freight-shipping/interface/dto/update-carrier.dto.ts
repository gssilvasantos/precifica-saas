import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateCarrierDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}
