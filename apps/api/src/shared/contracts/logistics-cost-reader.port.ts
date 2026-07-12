// Porta exportada pelo Logistics Fulfillment, consumida pelo Promotion
// Intelligence (Sprint 26) — nenhum consumidor conhece Warehouse,
// StockLedgerEntry ou a hierarquia de embalagem por trás disto, só este
// contrato. Ver docs/promotion-intelligence-architecture.md e
// docs/logistics-fulfillment-architecture.md, seção "Hierarquia de custo
// logístico".
//
// getTotalLogisticsCost = custo de embalagem (hierarquia: kit/GROUPING ->
// vínculo individual -> SAFETY_DEFAULT) + custo operacional do Warehouse
// Full do canal (Warehouse.logisticsCostPerUnit). Composto aqui dentro,
// nunca pelo chamador — "evitar redundância de dados" (pedido explícito do
// usuário): se o custo da embalagem mudar no módulo de embalagens, a
// PRÓXIMA chamada já reflete, sem nenhum outro lugar guardar cópia.
export interface LogisticsCostReader {
  getTotalLogisticsCost(tenantId: string, skuCode: string, channelCode: string): Promise<number>;

  // Hierarquia completa (Prioridades 1/2/3) para um PEDIDO real com vários
  // itens — não usado pelo PromotionIntelligenceService (que avalia 1 SKU
  // isolado, antes de qualquer pedido existir), pronto para o CMV de
  // Orders/DRE consumir no futuro. Ver docs/promotion-intelligence-architecture.md,
  // seção "Por que a Prioridade 2 não entra no motor de promoções".
  getPackagingCostForOrder(tenantId: string, items: { skuCode: string; quantity: number }[]): Promise<number>;
}
