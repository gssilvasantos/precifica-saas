import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const LISTING_TYPE_IDS = ['gold_special', 'gold_pro'] as const;

export class SimulateMercadoLivreMarginDto {
  @IsString()
  @MinLength(1)
  skuCode!: string;

  // 'gold_special' = Clássico, 'gold_pro' = Premium. Omitido = Clássico
  // (ver DEFAULT_LISTING_TYPE_ID no service).
  @IsOptional()
  @IsIn(LISTING_TYPE_IDS)
  listingTypeId?: 'gold_special' | 'gold_pro';
}
