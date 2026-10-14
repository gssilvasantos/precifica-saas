import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const BUY_BOX_STATUS_VALUES = ['WINNING', 'LOSING', 'UNKNOWN'] as const;

export class ListBuyBoxTransitionsQueryDto {
  // Filtra pelo status PARA ONDE a transição foi — ex.: newStatus=LOSING
  // responde exatamente "quais SKUs passaram a perder".
  @IsOptional()
  @IsIn(BUY_BOX_STATUS_VALUES)
  newStatus?: (typeof BUY_BOX_STATUS_VALUES)[number];

  @IsOptional()
  @IsString()
  skuCode?: string;

  // ISO 8601 — só transições detectadas a partir deste instante.
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  detectedSince?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
