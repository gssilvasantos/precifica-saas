import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { TaxRegime } from '@prisma/client';

export class CreateTaxProfileDto {
  @IsString()
  name!: string;

  @IsEnum(TaxRegime)
  regime!: TaxRegime;

  // Alíquota estimada total (%), aplicada sobre o preço de venda no motor de
  // precificação. Simplificação intencional — ver nota no schema.prisma.
  @IsNumber()
  @Min(0)
  @Max(100)
  estimatedRatePct!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
