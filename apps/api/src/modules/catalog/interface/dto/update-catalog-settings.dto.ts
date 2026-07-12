import { IsNumber, Max, Min } from 'class-validator';

export class UpdateCatalogSettingsDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  desiredMarginPct!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  minimumMarginPct!: number;
}
