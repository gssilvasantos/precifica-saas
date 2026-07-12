import { Type } from 'class-transformer';
import { IsNumber, IsPositive, IsString } from 'class-validator';

// Pré-visualização do Motor de Margem antes de decidir aderir de verdade —
// não grava nada (ver PromotionIntelligenceService.computeMargin).
export class MarginPreviewQueryDto {
  @IsString()
  skuCode!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  promotionalPrice!: number;
}
