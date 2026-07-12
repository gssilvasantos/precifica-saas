// Mesma convenção de eventos de domínio do resto da plataforma (string +
// payload tipado, via EventEmitter2 — ver competition-events.ts). Existe só
// para uma coisa: avisar FinancialPolicyReaderService de que o cache que ele
// mantém em memória ficou desatualizado, sem CatalogSettingsService precisar
// conhecer o cache (ou o módulo Pricing Intelligence) diretamente.
export const CATALOG_SETTINGS_EVENTS = {
  FINANCIAL_POLICY_UPDATED: 'catalog-settings.financial-policy-updated',
} as const;

export interface FinancialPolicyUpdatedEvent {
  tenantId: string;
}
