import { IsArray, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';

export class UpdateCarrierServiceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsInt()
  @IsPositive()
  estimativaEntregaDias?: number;

  // String vazia é um valor válido aqui — significa "limpar automationCode"
  // (CarrierCatalogService trata '' como null); só ausência do campo mantém
  // o valor atual.
  @IsOptional()
  @IsString()
  automationCode?: string;
}
