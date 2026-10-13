import { apiClient } from '../../lib/api-client';

export interface SimulateNuvemshopMarginInput {
  skuCode: string;
  installments: number;
  receivingWindowDays: number;
  freeShipping?: boolean;
  estimatedShippingCost?: number;
  couponCost?: number;
}

export interface SimulateNuvemshopMarginOutput {
  skuCode: string;
  productName: string;
  grossPrice: number;
  costPrice: number;
  gatewayFeePct: number;
  gatewayFeeAmount: number;
  shippingDeduction: number;
  couponDeduction: number;
  netRevenue: number;
  netMargin: number;
  netMarginPct: number;
  feeRuleFound: boolean;
}

export async function simulateNuvemshopMargin(
  input: SimulateNuvemshopMarginInput,
): Promise<SimulateNuvemshopMarginOutput> {
  const { data } = await apiClient.post<SimulateNuvemshopMarginOutput>('/pricing-intelligence/nuvemshop/simulate', input);
  return data;
}

// Simuladores de Mercado Livre e Shopee (13/10/2026) — mesma forma do
// resultado "achatado" (custo total já embutido em feeAmount, ao contrário
// do detalhamento gatewayFeePct/shippingDeduction/couponDeduction da
// Nuvemshop, que não existem nesses dois canais) — ver
// marketplace-fee-margin-calculator.ts no backend.
export interface SimulateMercadoLivreMarginInput {
  skuCode: string;
  listingTypeId?: 'gold_special' | 'gold_pro';
}

export interface SimulateShopeeMarginInput {
  skuCode: string;
}

export interface SimulateMarketplaceFeeMarginOutput {
  skuCode: string;
  productName: string;
  grossPrice: number;
  costPrice: number;
  feeAmount: number;
  netRevenue: number;
  netMargin: number;
  netMarginPct: number;
  feeRuleFound: boolean;
}

export async function simulateMercadoLivreMargin(
  input: SimulateMercadoLivreMarginInput,
): Promise<SimulateMarketplaceFeeMarginOutput> {
  const { data } = await apiClient.post<SimulateMarketplaceFeeMarginOutput>('/pricing-intelligence/mercado-livre/simulate', input);
  return data;
}

export async function simulateShopeeMargin(
  input: SimulateShopeeMarginInput,
): Promise<SimulateMarketplaceFeeMarginOutput> {
  const { data } = await apiClient.post<SimulateMarketplaceFeeMarginOutput>('/pricing-intelligence/shopee/simulate', input);
  return data;
}
