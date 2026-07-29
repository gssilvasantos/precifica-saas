import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateNaturezaOperacaoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nome?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cfopVendaInterno?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cfopVendaInterestadual?: string;

  @IsOptional()
  @IsString()
  cfopDevolucaoInterno?: string;

  @IsOptional()
  @IsString()
  cfopDevolucaoInterestadual?: string;
}
