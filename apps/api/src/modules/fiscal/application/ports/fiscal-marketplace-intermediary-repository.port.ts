// Grupo G da NF-e (NT 2020.006) — benchmark Bling, 29/07/2026 (ver
// docs/bling-erp-benchmark-analysis.md, seção 1.4). Uma linha por
// (tenantId, channelCode) — o CNPJ do intermediador varia por marketplace,
// nunca um valor único por tenant (diferente de FiscalSettings, que É
// singleton por tenant).
export interface FiscalMarketplaceIntermediaryRecord {
  id: string;
  tenantId: string;
  channelCode: string;
  cnpj: string;
  idCadIntTran: string;
  createdAt: Date;
  updatedAt: Date;
}

export type FiscalMarketplaceIntermediaryUpsertData = {
  tenantId: string;
  channelCode: string;
  cnpj: string;
  idCadIntTran: string;
};

export interface FiscalMarketplaceIntermediaryRepository {
  findByTenantAndChannel(tenantId: string, channelCode: string): Promise<FiscalMarketplaceIntermediaryRecord | null>;
  findAllByTenant(tenantId: string): Promise<FiscalMarketplaceIntermediaryRecord[]>;
  upsert(data: FiscalMarketplaceIntermediaryUpsertData): Promise<FiscalMarketplaceIntermediaryRecord>;
  remove(tenantId: string, channelCode: string): Promise<void>;
}

export const FISCAL_MARKETPLACE_INTERMEDIARY_REPOSITORY = Symbol('FISCAL_MARKETPLACE_INTERMEDIARY_REPOSITORY');
