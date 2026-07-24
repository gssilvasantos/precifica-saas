// Contratos que qualquer adaptador de marketplace implementa. Ver
// docs/marketplace-intelligence-architecture.md, seção 3, para o racional.
// Interface Segregation: um provider só implementa a(s) capacidade(s) que
// de fato sabe entregar — nunca uma interface única "faz tudo".

export enum ProviderCapability {
  FEE_RULES = 'FEE_RULES',
  SHIPPING_POLICY = 'SHIPPING_POLICY',
  CATEGORY_TAXONOMY = 'CATEGORY_TAXONOMY',
  AUTH = 'AUTH',
  // Lado de escrita/repricing (ver ListingCapableProvider/PriceUpdateCapableProvider).
  LISTINGS = 'LISTINGS',
  PRICE_UPDATE = 'PRICE_UPDATE',
  // Hub de pedidos multicanal (ver OrderCapableProvider, docs/orders-architecture.md).
  ORDERS = 'ORDERS',
  // Módulo de Ads multicanal, Fase 1 (ver AdsCapableProvider,
  // docs/marketplace-ads-architecture.md).
  ADS = 'ADS',
  // Módulo de Ads multicanal, Fase 3 — ações de ESCRITA (ver
  // AdsActionCapableProvider, docs/marketplace-ads-architecture.md, seção 12).
  // Capacidade separada de ADS (Interface Segregation): um provider pode ler
  // campanhas sem necessariamente saber executar uma ação sobre elas.
  ADS_ACTIONS = 'ADS_ACTIONS',
}

export interface RawRuleCandidate {
  scopeKey: string;
  payload: unknown; // validado pelo RulePayloadValidator do ruleType antes de persistir
  sourceEvidenceRef?: string;
  fetchedAt: Date;
}

export interface FetchContext {
  marketplaceCode: string;
  tenantId?: string; // presente só quando a captura depende de credencial do vendedor
  since?: Date; // sync incremental, quando o provider suportar
}

export interface ProviderHealthStatus {
  status: 'UP' | 'DEGRADED' | 'DOWN';
  message?: string;
}

// Todo provider implementa isso, no mínimo.
export interface MarketplaceProvider {
  readonly code: string; // ex.: "MERCADO_LIVRE_API_V1"
  readonly marketplaceCode: string; // ex.: "MERCADO_LIVRE"
  readonly sourceType: 'OFFICIAL_API' | 'OFFICIAL_DOCS' | 'IMPORTED_FILE' | 'MANUAL';
  readonly capabilities: ProviderCapability[];
  healthCheck(): Promise<ProviderHealthStatus>;

  // Opcional: só implementado por providers cujo dado é POR TENANT (ex.:
  // NuvemshopFeeRuleProvider — cada loja tem seu próprio contrato de
  // gateway), diferente de providers de dado público/global (ex.: Mercado
  // Livre). Quando presente, RuleSyncOrchestrator sincroniza uma vez por
  // tenant retornado aqui, em vez de uma única vez global — ver
  // docs/erp-integration-architecture.md, seção sobre Nuvemshop.
  listTenantIdsToSync?(): Promise<string[]>;
}

export interface FeeRuleCapableProvider extends MarketplaceProvider {
  fetchFeeRules(ctx: FetchContext): Promise<RawRuleCandidate[]>;
}

export interface ShippingPolicyCapableProvider extends MarketplaceProvider {
  fetchShippingPolicies(ctx: FetchContext): Promise<RawRuleCandidate[]>;
}

export interface CategoryTaxonomyCapableProvider extends MarketplaceProvider {
  fetchCategoryTaxonomy(ctx: FetchContext): Promise<RawRuleCandidate[]>;
}

export interface AuthenticatedProvider extends MarketplaceProvider {
  readonly authScope: 'PLATFORM' | 'TENANT';
  ensureValidCredentials(tenantId?: string): Promise<void>;
}

// --- Capacidades de ESCRITA/leitura de anúncio — o lado "repricing" que o
// Pricing Engine vai comandar sem saber qual canal está do outro lado. Até
// aqui (Etapa 4/5) todo provider era read-only (captura de regra de taxa,
// captura de listing para vínculo de SKU). Estas duas interfaces são a
// primeira vez que a arquitetura de providers ganha um lado de escrita —
// ver docs/marketplace-intelligence-architecture.md, seção sobre repricing.

export interface ExternalListing {
  externalId: string; // id do anúncio/produto no canal
  skuCode: string;
  currentPrice: number;
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED';
}

export interface ListingCapableProvider extends MarketplaceProvider {
  // Lista os anúncios ativos do tenant no canal — o mesmo papel que
  // NuvemshopChannelListingSyncService já cumpre hoje "na mão" para a
  // Nuvemshop; formalizar como capacidade de provider é o que permite um
  // orquestrador genérico (não um serviço por canal) alimentar ChannelListing
  // para qualquer canal novo, só implementando esta interface.
  listActiveListings(ctx: FetchContext): Promise<ExternalListing[]>;
}

export interface PriceUpdateResult {
  success: boolean;
  externalId: string;
  appliedPrice?: number;
  message?: string;
}

export interface PriceUpdateCapableProvider extends MarketplaceProvider {
  // Comando de escrita — quem chama isso (PriceUpdateDispatcherService) não
  // sabe nem precisa saber que por trás existe uma chamada OAuth2 para a
  // API do Mercado Livre ou um POST para a Nuvemshop. Só o provider sabe.
  updatePrice(ctx: FetchContext, externalId: string, newPrice: number): Promise<PriceUpdateResult>;
}

// --- Hub de pedidos multicanal (Módulo de Pedidos) — mesmo racional das
// capacidades acima: cada canal expõe pedidos com um formato e um
// vocabulário de status completamente diferentes; o adapter concreto
// (ex.: NuvemshopOrderProvider) é o ÚNICO lugar que conhece esse formato
// bruto, e devolve `RawOrderCandidate[]` JÁ no payload normalizado —
// inclusive com `status` já traduzido para os 6 estágios canônicos (ver
// `UnifiedOrderStatus` abaixo, que espelha `enum OrderStatus` do Prisma —
// duplicado de propósito, mesmo padrão de `BuyBoxStatus`: este arquivo é
// puro TS, não pode importar o client gerado do Prisma).
//
// Paginação é responsabilidade do PROVIDER, não do orquestrador: cada
// adapter percorre as páginas da API do canal internamente (mesmo padrão
// já usado em NuvemshopApiClient.fetchAllProducts) e devolve a lista
// completa da janela pedida (`ctx.since`) de uma vez — o orquestrador
// genérico (OrderSyncOrchestrator) só sabe fazer upsert por
// (tenantId, channelCode, externalOrderId), nunca lida com cursor/página.
export type UnifiedOrderStatus = 'EM_ABERTO' | 'PREPARANDO_ENVIO' | 'FATURADO' | 'ENVIADO' | 'ENTREGUE' | 'CANCELADO';

// Espelha o enum Prisma FiscalResponsibility (Etapa 17) — ver
// docs/orders-architecture.md, seção 12.
export type FiscalResponsibility = 'SELLER' | 'MARKETPLACE';

export interface RawOrderItemCandidate {
  externalSku: string; // sku/id do produto NO CANAL — sempre presente
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  // Imposto discriminado por item (Etapa 17, regras fiscais de NF-e) —
  // opcional: nulo/ausente quando o canal não expõe essa quebra.
  taxAmount?: number;
}

// --- Normalização financeira (Etapa 17) ---
// feeAmount/netAmount são responsabilidade EXCLUSIVA do adapter — cada
// canal conhece sua própria estrutura de comissão (ou a ausência dela, como
// a Nuvemshop, que é a loja própria do vendedor). O adaptador entrega o
// pedido já com o valor líquido calculado; nenhum serviço de aplicação
// (ReceivableFromOrderListener, em especial) faz `if (channelCode === X)`
// para descobrir quanto o vendedor de fato recebe. Ver
// docs/orders-architecture.md, seção 11, para o racional completo e o
// porquê de isso evitar se transformar num "motor de regras" paralelo.
export interface RawOrderCandidate {
  externalOrderId: string; // metade da chave de idempotência (a outra é channelCode, resolvido pelo orquestrador)
  status: UnifiedOrderStatus; // já traduzido pelo adapter — nunca o status bruto
  externalStatus: string; // status bruto do canal, preservado para auditoria
  subtotalAmount: number;
  shippingAmount: number;
  discountAmount: number;
  totalAmount: number;
  // Comissão do marketplace deduzida deste pedido — 0 é um valor válido e
  // honesto (ex.: Nuvemshop não tem comissão de marketplace sobre o pedido).
  feeAmount: number;
  // O que o vendedor de fato recebe (totalAmount - feeAmount - qualquer
  // outra dedução que o canal exponha). É este campo, não totalAmount, que
  // alimenta ReceivableRecord.amount.
  netAmount: number;
  currency: string;
  // Campos fiscais (Etapa 17) — todos opcionais: nenhum adapter hoje
  // (Nuvemshop) os preenche, mas Amazon/Magalu podem exigir.
  fiscalResponsibility?: FiscalResponsibility;
  buyerTaxId?: string;
  invoiceNumber?: string;
  shippingDeadlineAt?: Date;
  orderedAt: Date;
  paidAt?: Date;
  shippedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  items: RawOrderItemCandidate[];
  rawPayload?: unknown; // payload cru do canal — auditoria/depuração, nunca lido pelo domínio
}

export interface OrderCapableProvider extends MarketplaceProvider {
  fetchOrders(ctx: FetchContext): Promise<RawOrderCandidate[]>;
}

export function isFeeRuleCapable(p: MarketplaceProvider): p is FeeRuleCapableProvider {
  return p.capabilities.includes(ProviderCapability.FEE_RULES);
}

export function isListingCapable(p: MarketplaceProvider): p is ListingCapableProvider {
  return p.capabilities.includes(ProviderCapability.LISTINGS);
}

export function isPriceUpdateCapable(p: MarketplaceProvider): p is PriceUpdateCapableProvider {
  return p.capabilities.includes(ProviderCapability.PRICE_UPDATE);
}

export function isOrderCapable(p: MarketplaceProvider): p is OrderCapableProvider {
  return p.capabilities.includes(ProviderCapability.ORDERS);
}

// --- Módulo de Ads multicanal (Fase 1, escopo Mercado Livre — ver
// docs/marketplace-ads-architecture.md). Mesmo racional de RawOrderCandidate:
// o adapter concreto (MercadoLivreAdsProvider) é o ÚNICO lugar que conhece o
// formato bruto do canal; devolve os dois candidatos já normalizados.
// Granularidade de campanha (não ad-group/ad individual) de propósito no
// MVP — ver seção 2 do doc.
//
// Deliberadamente SEM `revenueOrganic`/TACOS aqui: nenhuma API de Ads de
// marketplace devolve "receita orgânica" (é uma métrica DERIVADA, não um
// fato do canal) — o TACOS é calculado no application layer
// (AdsInsightsService) combinando `spend` daqui com a receita total do
// tenant no período, vinda de ORDER_FINANCIALS_READER (já existe, é a MESMA
// porta que alimenta o DRE — nunca duplicar essa fonte).
export interface RawAdsCampaignCandidate {
  externalCampaignId: string; // id da campanha no marketplace
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED' | 'UNKNOWN'; // já traduzido pelo adapter
  dailyBudget: number | null;
}

export interface RawAdsMetricCandidate {
  externalCampaignId: string;
  periodDate: Date; // granularidade diária — mesma janela que a maioria das APIs de ads reporta
  spend: number;
  revenueAds: number; // vendas atribuídas ao anúncio pelo próprio marketplace
  clicks: number;
  impressions: number;
}

export interface AdsCapableProvider extends MarketplaceProvider {
  fetchAdsCampaigns(ctx: FetchContext): Promise<RawAdsCampaignCandidate[]>;
  // dateFrom/dateTo: a maioria das APIs de ads limita a janela de métricas
  // (ex.: Mercado Livre limita a 90 dias) — quem decide a janela é o
  // orquestrador (AdsSyncOrchestrator), o provider só respeita o que
  // recebeu; se o canal tiver um limite menor, o adapter deve lançar erro
  // explícito, nunca truncar silenciosamente.
  fetchAdsMetrics(ctx: FetchContext, dateFrom: Date, dateTo: Date): Promise<RawAdsMetricCandidate[]>;
}

export function isAdsCapable(p: MarketplaceProvider): p is AdsCapableProvider {
  return p.capabilities.includes(ProviderCapability.ADS);
}

// --- Ações de escrita em Ads (Fase 3 — Safety Lock, ver
// docs/marketplace-ads-architecture.md, seção 12). Mesmo racional de
// PriceUpdateCapableProvider: capacidade de ESCRITA separada da capacidade
// de leitura (ADS) — Interface Segregation, um provider pode ler campanhas
// sem necessariamente saber executar uma ação sobre elas.
//
// Único método no MVP: pausar uma campanha. É a única recomendação
// ACIONÁVEL que classifyCampaignHealth já dá para CUSTO_PERDIDO ("candidata
// a pausar") — ajustar orçamento (reduzir X%) exigiria uma heurística nova,
// mais especulativa, fora do escopo desta fatia. Quem decide QUANDO chamar
// isto nunca é o provider: é o AdsActionDispatcherService, e só depois de
// confirmação explícita do usuário (o "Safety Lock" em si).
export interface AdsActionResult {
  success: boolean;
  message?: string;
}

export interface AdsActionCapableProvider extends MarketplaceProvider {
  pauseCampaign(ctx: FetchContext, externalCampaignId: string): Promise<AdsActionResult>;
}

export function isAdsActionCapable(p: MarketplaceProvider): p is AdsActionCapableProvider {
  return p.capabilities.includes(ProviderCapability.ADS_ACTIONS);
}
