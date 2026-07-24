import { IsNumber, IsOptional, IsPositive, Max, Min } from 'class-validator';

export class UpdateFinancialPolicyDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRatePct!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  minProfitMarginPct!: number;

  // Fase 4 (Ads — sugestão via IA). Opcional de propósito: omitido = não
  // altera o valor já salvo (PUT parcial, ver
  // CatalogSettingsRepository.upsertFinancialPolicy). Sem limite superior —
  // ao contrário de taxRatePct/minProfitMarginPct (percentuais, 0-100), ROAS
  // é um múltiplo (3 = "3x o gasto"), sem teto natural.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  targetRoas?: number;
}
