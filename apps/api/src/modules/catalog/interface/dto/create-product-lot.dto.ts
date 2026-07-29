import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateProductLotDto {
  @IsString()
  lotCode!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dataFabricacao?: Date;

  @Type(() => Date)
  @IsDate()
  dataValidade!: Date;

  @IsOptional()
  @IsInt()
  @Min(0)
  diasPermitidoVenda?: number;

  @IsOptional()
  @IsString()
  codigoAgregacao?: string;
}
