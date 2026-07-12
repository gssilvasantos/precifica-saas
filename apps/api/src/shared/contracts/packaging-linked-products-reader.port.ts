// Porta de leitura exportada pelo Catalog, consumida pelo Pricing
// Intelligence só para responder "quais SKUs precisam ser recalculados
// quando esta embalagem mudou de custo" (ver PackagingCostChangeListener).
// Deliberadamente enxuta — não expõe o produto inteiro, só a lista de
// skuCode, que é tudo que PricingDecisionService.decideAndMaybeApply precisa
// para reprocessar cada um.
export interface PackagingLinkedProductsReader {
  findSkuCodesByPackaging(tenantId: string, packagingId: string): Promise<string[]>;
}
