import { IsNumber, IsPositive, IsString } from 'class-validator';

// Adesão de um SKU a uma campanha já existente — o canal vem da campanha
// (campaign.channelCode), nunca informado de novo aqui, para não correr o
// risco de calcular a margem contra um canal diferente do que a promoção
// realmente vai rodar.
export class EnrollSkuDto {
  @IsString()
  skuCode!: string;

  @IsNumber()
  @IsPositive()
  promotionalPrice!: number;
}
