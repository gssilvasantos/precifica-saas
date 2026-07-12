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
