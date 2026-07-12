// Mesma convenção de eventos de domínio do resto da plataforma. Existe para
// que o Pricing Intelligence possa reagir a "o custo de uma embalagem
// mudou" sem o Catalog precisar conhecer o Pricing Engine — mesmo
// desacoplamento de CATALOG_SETTINGS_EVENTS.FINANCIAL_POLICY_UPDATED.
//
// Importante: isto NÃO é necessário para o CÁLCULO em si estar correto —
// CatalogReaderService.findBySku já lê o custo da embalagem fresco, sem
// cache, a cada chamada (ver pricing-intelligence-architecture.md, seção 9).
// Este evento serve para REPRECIFICAÇÃO PROATIVA: sem ele, um SKU com
// autoRepricingEnabled=true só teria o preço recalculado no próximo sinal de
// concorrência (BUY_BOX_LOST) ou clique manual em "Aplicar Preço Agora" —
// com o evento, o próprio PATCH de embalagem já dispara o recálculo para
// todos os produtos vinculados, na hora.
export const PACKAGING_EVENTS = {
  COST_CHANGED: 'catalog.packaging-cost-changed',
} as const;

export interface PackagingCostChangedEvent {
  tenantId: string;
  packagingId: string;
  previousCostPrice: number;
  newCostPrice: number;
}
