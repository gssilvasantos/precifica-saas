export interface CatalogSettings {
  tenantId: string;
  defaultDesiredMarginPct: number;
  defaultMinimumMarginPct: number;
  taxRatePct: number;
  minProfitMarginPct: number;
}

export interface CatalogSettingsRepository {
  findByTenant(tenantId: string): Promise<CatalogSettings | null>;
  upsertMargins(tenantId: string, defaultDesiredMarginPct: number, defaultMinimumMarginPct: number): Promise<CatalogSettings>;
  // Separado de upsertMargins de propósito: são dois conceitos de governança
  // distintos (piso por SKU vs. política financeira global do tenant — ver
  // comentário no schema.prisma), atualizados por telas/fluxos diferentes.
  upsertFinancialPolicy(tenantId: string, taxRatePct: number, minProfitMarginPct: number): Promise<CatalogSettings>;
}

export const CATALOG_SETTINGS_REPOSITORY = Symbol('CATALOG_SETTINGS_REPOSITORY');
