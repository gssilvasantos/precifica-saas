import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

// DTOs do planejador "Buy Box + Campanhas" do Mercado Livre (07/10/2026).
// Margem e alíquota em PERCENTUAL (5 = 5%), igual ao que o Gui vê no
// Mercado Turbo — o serviço converte para fração.

export class MlCatalogItemsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MlCatalogPlanQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5)
  @Max(100)
  minMarginPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(99.99)
  taxRatePct?: number;
}

export class MlJoinPromotionDto {
  @IsString()
  @MaxLength(64)
  promotionId!: string;

  // O cliente informa o preço desejado; o servidor recalcula margem e faixa
  // aceita pela campanha antes de escrever qualquer coisa no ML.
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  dealPrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5)
  @Max(100)
  minMarginPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(99.99)
  taxRatePct?: number;
}

// Criar anúncio de catálogo pelo EAN (09/10/2026). O cliente só informa o
// anúncio de origem (na rota); preço, EAN, ficha e custo vêm do servidor.
export class MlCatalogCreationOptionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5)
  @Max(99)
  targetMarginPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(99.99)
  taxRatePct?: number;
}

export const ML_ITEM_ID_PATTERN = /^MLB\d{6,15}$/;

export class MlItemIdParam {
  @Matches(ML_ITEM_ID_PATTERN, { message: 'itemId deve ter o formato MLB seguido de dígitos.' })
  itemId!: string;
}
