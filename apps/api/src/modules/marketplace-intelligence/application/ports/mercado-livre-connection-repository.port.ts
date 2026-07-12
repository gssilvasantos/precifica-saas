// Sprint 22 — mesmo racional de NuvemshopConnectionRepository (erp-integration):
// porta local ao módulo, sem token em shared/contracts, porque só é consumida
// dentro do próprio marketplace-intelligence (MercadoLivreConnectionService,
// MercadoLivreOrderProvider) — nenhum outro módulo precisa desta credencial
// diretamente.
export interface MercadoLivreConnectionRecord {
  tenantId: string;
  sellerId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenType: string;
  scope: string | null;
  expiresAt: Date;
  isActive: boolean;
  lastRefreshedAt: Date | null;
}

export interface MercadoLivreConnectionUpsertData {
  sellerId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenType: string;
  scope: string | null;
  expiresAt: Date;
}

export interface MercadoLivreConnectionRepository {
  findByTenant(tenantId: string): Promise<MercadoLivreConnectionRecord | null>;
  findAllActive(): Promise<MercadoLivreConnectionRecord[]>;
  // Usado tanto no primeiro connect (token exchange) quanto em toda
  // renovação (refresh) — em ambos os casos o Mercado Livre devolve um par
  // access_token/refresh_token NOVO, então é sempre uma substituição
  // completa, nunca um patch parcial. `lastRefreshedAt` é atualizado pelo
  // repositório (não pelo chamador) para o momento do upsert.
  upsert(tenantId: string, data: MercadoLivreConnectionUpsertData): Promise<MercadoLivreConnectionRecord>;
  deactivate(tenantId: string): Promise<void>;
}

export const MERCADO_LIVRE_CONNECTION_REPOSITORY = Symbol('MERCADO_LIVRE_CONNECTION_REPOSITORY');
