import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCarrierDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}
