// Integração Shopee (27/07/2026) — mesmo racional de
// MercadoLivreConnectionRepository: porta local ao módulo, sem token em
// shared/contracts, porque só é consumida dentro do próprio
// marketplace-intelligence.
export interface ShopeeConnectionRecord {
  tenantId: string;
  shopId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date;
  isActive: boolean;
  lastRefreshedAt: Date | null;
}

export interface ShopeeConnectionUpsertData {
  shopId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date;
}

export interface ShopeeConnectionRepository {
  findByTenant(tenantId: string): Promise<ShopeeConnectionRecord | null>;
  findAllActive(): Promise<ShopeeConnectionRecord[]>;
  // Usado tanto no primeiro connect (token exchange) quanto em toda
  // renovação (refresh) — em ambos os casos a Shopee devolve um par
  // access_token/refresh_token NOVO, então é sempre uma substituição
  // completa, nunca um patch parcial. `lastRefreshedAt` é atualizado pelo
  // repositório (não pelo chamador) para o momento do upsert.
  upsert(tenantId: string, data: ShopeeConnectionUpsertData): Promise<ShopeeConnectionRecord>;
  deactivate(tenantId: string): Promise<void>;
}

export const SHOPEE_CONNECTION_REPOSITORY = Symbol('SHOPEE_CONNECTION_REPOSITORY');
