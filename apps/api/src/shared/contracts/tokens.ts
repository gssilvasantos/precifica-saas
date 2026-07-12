// Tokens de injeção de dependência para portas compartilhadas entre módulos.
// Ver docs/platform-architecture.md, seção 3 — módulo nunca importa a classe
// concreta de outro módulo, só o token + a interface.
export const SHIPPING_WEIGHT_CALCULATOR = Symbol('SHIPPING_WEIGHT_CALCULATOR');

// Exportado pelo Marketplace Intelligence, consumido pelo futuro Pricing Intelligence.
export const FEE_RULE_RESOLVER = Symbol('FEE_RULE_RESOLVER');

// Exportado pelo Catalog (Etapa 5), consumido pelo erp-integration.
export const PRODUCT_CATALOG_WRITER = Symbol('PRODUCT_CATALOG_WRITER');

// Exportado pelo erp-integration (Etapa 5) — implementação local de disco
// hoje; qualquer módulo que precise persistir arquivo consome só o token.
export const FILE_STORAGE = Symbol('FILE_STORAGE');

// Exportado pelo Catalog — porta de leitura consumida pelo Pricing Intelligence.
export const PRODUCT_CATALOG_READER = Symbol('PRODUCT_CATALOG_READER');

// Exportado pelo erp-integration (dono de ChannelListing) — consumido pelo
// Pricing Intelligence e, futuramente, por Competition Intelligence.
export const CHANNEL_LISTING_READER = Symbol('CHANNEL_LISTING_READER');

// Exportado pelo Marketplace Intelligence — o comando de repricing que o
// Pricing Engine dispara sem saber qual provider/canal está por trás.
export const PRICE_UPDATE_DISPATCHER = Symbol('PRICE_UPDATE_DISPATCHER');

// Exportado pelo Competition Intelligence — a "situação atual" do concorrente
// por SKU (read-model enxuto, não histórico). Consumido pelo Pricing Engine.
export const COMPETITOR_SNAPSHOT_READER = Symbol('COMPETITOR_SNAPSHOT_READER');

// Exportado pelo Catalog (CatalogSettings) — a política financeira do
// tenant (imposto + margem líquida mínima global) consumida pelo
// PricingDecisionService para calcular o piso financeiro.
export const FINANCIAL_POLICY_READER = Symbol('FINANCIAL_POLICY_READER');

// Exportado pelo Catalog — consumido pelo PackagingCostChangeListener
// (Pricing Intelligence) para descobrir quais SKUs recalcular quando o
// custo de uma Packaging muda (ver domain/packaging-events.ts).
export const PACKAGING_LINKED_PRODUCTS_READER = Symbol('PACKAGING_LINKED_PRODUCTS_READER');

// Exportado pelo Orders (Etapa 20) — consolidado financeiro por pedido, já
// com o custo resolvido (fallback da Etapa 19), consumido pelo
// FinancialOrchestrator (Financial Intelligence) para montar o DRE por
// canal. Primeira porta em que Financial Intelligence importa outro módulo
// de negócio (sempre pela porta, nunca pela classe concreta OrdersService)
// — ver financial-intelligence.module.ts.
export const ORDER_FINANCIALS_READER = Symbol('ORDER_FINANCIALS_READER');

// Exportado pelo Catalog — consultas por PROPÓSITO de embalagem (kit,
// master, default de segurança), consumido pelo LogisticsCostReaderService
// (Logistics Fulfillment) para resolver a hierarquia de custo de embalagem
// do Motor de Margem de Promoções (Sprint 26). Irmã de
// PACKAGING_LINKED_PRODUCTS_READER, mas por purpose, não por SKU.
export const PACKAGING_COST_READER = Symbol('PACKAGING_COST_READER');

// Exportado pelo Logistics Fulfillment (Sprint 26) — custo logístico total
// (embalagem via hierarquia + operacional do Warehouse Full) por SKU x
// canal, consumido pelo PromotionIntelligenceService para calcular a M.C.
// Líquida. Primeira porta em que Promotion Intelligence importa outro
// módulo de negócio, sempre pela porta — ver promotion-intelligence.module.ts.
export const LOGISTICS_COST_READER = Symbol('LOGISTICS_COST_READER');
