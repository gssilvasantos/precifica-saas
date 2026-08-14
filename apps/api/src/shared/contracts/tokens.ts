// Tokens de injeção de dependência para portas compartilhadas entre módulos.
// Ver docs/platform-architecture.md, seção 3 — módulo nunca importa a classe
// concreta de outro módulo, só o token + a interface.
export const SHIPPING_WEIGHT_CALCULATOR = Symbol('SHIPPING_WEIGHT_CALCULATOR');

// Exportado pelo Marketplace Intelligence, consumido pelo Pricing
// Intelligence (motor de repricing e simulador) e pelo Promotion
// Intelligence. É por aqui que a comissão IMPORTADA do marketplace chega a
// quem calcula preço — ver docs/revisao-geral-2026-08.md, §1.
export const FEE_RULE_RESOLVER = Symbol('FEE_RULE_RESOLVER');

// Exportado pelo Marketplace Intelligence — política de frete do canal
// (quem paga a entrega e a partir de qual preço). Separado de
// FEE_RULE_RESOLVER porque comissão e frete variam por limiares que não têm
// relação entre si — ver shared/contracts/shipping-policy-resolver.port.ts.
export const SHIPPING_POLICY_RESOLVER = Symbol('SHIPPING_POLICY_RESOLVER');

// Exportado pelo Marketplace Intelligence — o que ESTE vendedor contratou
// em cada canal (Plano de vendas profissional da Amazon, desconto de frete
// por reputação no Mercado Livre). Distinto das duas portas acima, que
// descrevem como o CANAL cobra de todo mundo.
export const CHANNEL_SELLER_PROFILE_READER = Symbol('CHANNEL_SELLER_PROFILE_READER');

// Exportado pelo Marketplace Ads, consumido pelo Financial Intelligence —
// gasto com publicidade por canal, para a linha de Ads do DRE. Ver
// shared/contracts/ads-spend-reader.port.ts.
export const ADS_SPEND_READER = Symbol('ADS_SPEND_READER');

// Exportado pelo Marketplace Publishing (dono de ChannelCategoryMapping),
// consumido pelo Pricing Intelligence para traduzir a categoria interna do
// produto na categoria do canal — que é a chave (scopeKey) sob a qual a
// MarketplaceRule de comissão foi importada.
export const CHANNEL_CATEGORY_RESOLVER = Symbol('CHANNEL_CATEGORY_RESOLVER');

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

// Exportado pelo Orders — faturamento agregado POR MÊS, consumido pelo Tax
// Intelligence para montar o RBT12 do Simples Nacional. Separado de
// ORDER_FINANCIALS_READER porque somar 12 meses não deve carregar pedido a
// pedido — ver shared/contracts/monthly-revenue-reader.port.ts.
export const MONTHLY_REVENUE_READER = Symbol('MONTHLY_REVENUE_READER');

// Exportado pelo Tax Intelligence — a alíquota efetiva por produto, por UF e
// por data, calculada (não digitada). Consumido pelo Pricing Intelligence,
// Promotion Intelligence e Financial Intelligence. Sucessor do
// CatalogSettings.taxRatePct, que é um Float único por tenant e não representa
// nenhum dos quatro regimes brasileiros corretamente — ver
// shared/contracts/tax-rate-resolver.port.ts e
// docs/tributacao-br-regimes-e-reforma.md.
export const TAX_RATE_RESOLVER = Symbol('TAX_RATE_RESOLVER');

// Classificação fiscal derivada do NCM que o ERP já importa — consumida pelo
// sync do Olist. Ver product-tax-classifier.port.ts.
export const PRODUCT_TAX_CLASSIFIER = Symbol('PRODUCT_TAX_CLASSIFIER');

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

// Exportado pelo erp-integration (dono de ChannelListing) — irmã de
// CHANNEL_LISTING_READER, mas de ESCRITA: só `upsert` (nunca delete/find),
// consumida pelo ListingPublicationService (marketplace-publishing, Fase 4
// benchmark Tiny ERP) para vincular o SKU ao anúncio recém-criado assim que
// a publicação é confirmada pelo marketplace. Interface Segregation: nenhum
// módulo externo ganha acesso ao CHANNEL_LISTING_REPOSITORY completo (esse
// nunca sai do erp-integration), só a fatia de escrita que precisa.
export const CHANNEL_LISTING_WRITER = Symbol('CHANNEL_LISTING_WRITER');
