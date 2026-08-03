import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpsertChannelSellerProfileDto {
  // Amazon — "Plano de vendas profissional" (R$19/mês). true = a tarifa por
  // item do plano Individual (R$2) deixa de entrar no cálculo de preço.
  @IsOptional()
  @IsBoolean()
  professionalPlanActive?: boolean;

  // Mercado Livre — desconto de frete por reputação. FRAÇÃO (0.7 = 70%),
  // não percentual: mesma convenção de commissionPct em todo o sistema,
  // depois do bug de unidade de 01/08/2026.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  freightDiscountPct?: number;
}
