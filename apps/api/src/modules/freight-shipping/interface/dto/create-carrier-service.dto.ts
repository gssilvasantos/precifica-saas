import { IsArray, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';

// Catálogo de Transportador/Serviço (Projeto Estruturante 5, benchmark Bling
// ERP, 29/07/2026) — automationCode não é validado aqui além do tipo string;
// a validação real (bater com um dos códigos que resolveLabelStrategy
// conhece) acontece em CarrierCatalogService, via isValidAutomationCode.
export class CreateCarrierServiceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsInt()
  @IsPositive()
  estimativaEntregaDias?: number;

  @IsOptional()
  @IsString()
  automationCode?: string;
}
