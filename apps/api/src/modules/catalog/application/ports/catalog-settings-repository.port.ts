export interface CatalogSettings {
  tenantId: string;
  defaultDesiredMarginPct: number;
  defaultMinimumMarginPct: number;
  taxRatePct: number;
  minProfitMarginPct: number;
  // Fase 4 (Ads — sugestão via IA). null = tenant não configurou uma meta
  // própria ainda — ver DEFAULT_TARGET_ROAS em
  // shared/contracts/financial-policy-reader.port.ts para onde o fallback é
  // de fato aplicado (nunca aqui, este é o dado cru).
  targetRoas: number | null;
}

export interface CatalogSettingsRepository {
  findByTenant(tenantId: string): Promise<CatalogSettings | null>;
  upsertMargins(tenantId: string, defaultDesiredMarginPct: number, defaultMinimumMarginPct: number): Promise<CatalogSettings>;
  // Separado de upsertMargins de propósito: são dois conceitos de governança
  // distintos (piso por SKU vs. política financeira global do tenant — ver
  // comentário no schema.prisma), atualizados por telas/fluxos diferentes.
  // targetRoas é opcional (undefined = não alterar o valor já salvo, permite
  // PUT parcial sem forçar o cliente a sempre reenviar a meta de ROAS junto
  // de taxRatePct/minProfitMarginPct).
  upsertFinancialPolicy(
    tenantId: string,
    taxRatePct: number,
    minProfitMarginPct: number,
    targetRoas?: number,
  ): Promise<CatalogSettings>;
}

export const CATALOG_SETTINGS_REPOSITORY = Symbol('CATALOG_SETTINGS_REPOSITORY');
