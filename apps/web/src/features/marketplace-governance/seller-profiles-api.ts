import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/shared/contracts/channel-seller-profile-reader.port.ts
// — mesmo racional de duplicação intencional do resto do frontend.
//
// O que ESTE vendedor contratou em cada canal, distinto da tabela de taxas
// (que é importada do canal e vale para todo mundo). Ver
// docs/marketplace-fee-model-architecture.md, §2.0.
export interface ChannelSellerProfile {
  channelCode: string;
  // Amazon — "Plano de vendas profissional" (R$19/mês). Ativo = a tarifa
  // por item do plano Individual (R$2) não é cobrada.
  professionalPlanActive: boolean;
  // Mercado Livre — desconto de frete por reputação. FRAÇÃO (0.7 = 70%).
  freightDiscountPct: number;
}

export async function fetchSellerProfiles(): Promise<ChannelSellerProfile[]> {
  const { data } = await apiClient.get<ChannelSellerProfile[]>('/marketplace-intelligence/seller-profiles');
  return data;
}

export async function fetchSellerProfile(channelCode: string): Promise<ChannelSellerProfile> {
  const { data } = await apiClient.get<ChannelSellerProfile>(
    `/marketplace-intelligence/seller-profiles/${channelCode}`,
  );
  return data;
}

export async function updateSellerProfile(
  channelCode: string,
  input: { professionalPlanActive?: boolean; freightDiscountPct?: number },
): Promise<ChannelSellerProfile> {
  const { data } = await apiClient.put<ChannelSellerProfile>(
    `/marketplace-intelligence/seller-profiles/${channelCode}`,
    input,
  );
  return data;
}
