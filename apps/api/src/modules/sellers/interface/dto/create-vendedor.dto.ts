import { IsEmail, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateVendedorDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  aliquotaComissaoPct!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  descontoMaximoPct?: number;
}
