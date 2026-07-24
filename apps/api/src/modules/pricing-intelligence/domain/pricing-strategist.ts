// Núcleo de domínio do Pricing Engine — o "coração" pedido. Nome do módulo
// no código deste projeto é `pricing-intelligence` (é o mesmo bounded
// context que o PRD chama de "Pricing Engine"/"Pricing Intelligence" desde
// docs/platform-architecture.md, seção 2) — mantive o nome já em uso em vez
// de criar um módulo `pricing-engine` paralelo.
//
// DESACOPLAMENTO (resposta à pergunta 4 do pedido): este arquivo é 100%
// domínio puro — sem NestJS, sem Prisma, sem token de DI, sem `import` de
// nenhum outro módulo. `calculateOptimalPrice` recebe um `PricingContext`
// já MONTADO (dados simples: números e strings) e devolve uma
// `PricingDecision`, também dado simples. Ele nunca viu um
// `MarketplaceProvider`, nunca viu `PRICE_UPDATE_DISPATCHER`, nunca fez uma
// chamada assíncrona. Quem monta o `PricingContext` (buscando produto via
// `PRODUCT_CATALOG_READER` e oportunidade via `COMPETITOR_SNAPSHOT_READER`)
// é a camada de aplicação (`PricingDecisionService`, `application/`) — a
// mesma separação já usada em `opportunity-calculator.ts`
// (Competition Intelligence) e `nuvemshop-margin-calculator.ts`: cálculo
// puro num lado, orquestração de I/O do outro. É essa separação, não uma
// regra especial, que garante que o Strategist nunca precise saber que
// Mercado Livre/Nuvemshop/Shopee existem.

export type BuyBoxStatus = 'WINNING' | 'LOSING' | 'UNKNOWN';

export interface PricingContext {
  skuCode: string;
  costPrice: number;
  currentPrice: number;
  desiredMarginPct: number; // margem-alvo do produto (Product.desiredMarginPct)
  minimumMarginPct: number; // piso de segurança POR PRODUTO (Product.minimumMarginPct)
  // Governança financeira do TENANT (CatalogSettings.taxRatePct/minProfitMarginPct,
  // via FinancialPolicyReader) — fração (0 a <1), não percentual. Distinto
  // de minimumMarginPct acima: este é um piso GLOBAL, sempre em vigor,
  // independente da margem configurada em cada produto. Ver
  // calculateFinancialFloorPrice logo abaixo.
  taxRate: number;
  minProfitMargin: number;
  competitorBestPrice: number | null; // null quando buyBoxStatus é UNKNOWN (ainda sem leitura de concorrência)
  buyBoxStatus: BuyBoxStatus;
  // Política de Preço Mínimo Anunciado (MAP) — piso definido pelo
  // FORNECEDOR/MARCA (Product.mapPrice), não calculado a partir de
  // custo/margem como os dois pisos acima. null = sem restrição MAP para
  // este SKU. Ver calculateEffectiveFloorPrice/validatePriceAgainstMap.
  mapPrice: number | null;
}

export type PricingAction =
  | 'MATCH_COMPETITOR' // baixamos o preço para igualar o concorrente — seguro, dentro dos três pisos
  | 'HOLD_PRICE' // mantemos o preço atual (já vencendo, ou sem dado de concorrência ainda)
  | 'SAFETY_FLOOR_APPLIED' // o piso POR PRODUTO (minimumMarginPct) foi o mais restritivo e venceu a sugestão
  | 'FINANCIAL_FLOOR_APPLIED' // o piso FINANCEIRO do tenant (imposto + margem líquida mínima global) foi o mais restritivo e venceu
  | 'MAP_FLOOR_APPLIED'; // o piso de MAP (Product.mapPrice, definido pelo fornecedor) foi o mais restritivo e venceu

export interface PricingDecision {
  skuCode: string;
  action: PricingAction;
  recommendedPrice: number;
  currentPrice: number;
  resultingMarginPct: number;
  safetyFloorPrice: number; // piso por produto (minimumMarginPct) — sempre calculado, mesmo quando não é o vigente
  financialFloorPrice: number; // piso financeiro do tenant (imposto + margem mínima global) — idem
  hitSafetyFloor: boolean;
  hitFinancialFloor: boolean;
  // mapPrice ecoado da entrada (não recalculado — é um valor direto, não uma
  // fórmula) só para o chamador não precisar buscar Product de novo para
  // saber qual era o piso de MAP vigente nesta decisão.
  mapPrice: number | null;
  hitMapFloor: boolean;
  reason: string;
}

export class InvalidPricingContextError extends Error {
  constructor(reason: string) {
    super(`Contexto de precificação inválido: ${reason}`);
    this.name = 'InvalidPricingContextError';
  }
}

// Estratégia é pluggável de propósito (por isso interface, não só uma
// função solta como as outras calculadoras do projeto): "Strategist"
// sugere que hoje existe uma estratégia default (igualar concorrente
// respeitando o piso), mas amanhã pode haver uma agressiva (subcotar por
// X%), uma conservadora (só reage se o gap for grande) ou uma orientada por
// IA — todas implementando o mesmo contrato, plugadas via DI, sem o
// PricingDecisionService (quem consome) precisar mudar.
export interface PricingStrategist {
  calculateOptimalPrice(context: PricingContext): PricingDecision;
}

// Token de DI — colocado aqui (junto da interface), não num arquivo de
// registry separado, porque hoje só existe UMA implementação ativa por vez
// (troca de binding no module), diferente de MARKETPLACE_PROVIDERS/
// COMPETITION_RADARS (arrays de múltiplos providers simultâneos).
export const PRICING_STRATEGIST = Symbol('PRICING_STRATEGIST');

// Margem convencionada sobre o PREÇO DE VENDA — (preço - custo) / preço —
// mesma convenção usada em toda a plataforma (ver
// nuvemshop-margin-calculator.ts e features/catalog/margin-status.ts no
// frontend). Mantém os números comparáveis entre módulos.
export function marginPctOf(price: number, costPrice: number): number {
  if (price <= 0) return -Infinity;
  return ((price - costPrice) / price) * 100;
}

// O "preço de segurança" POR PRODUTO: o menor preço que ainda entrega
// exatamente minimumMarginPct de margem sobre o preço de venda. Derivado
// invertendo a fórmula de margem: margem = (P - custo) / P  =>
// P = custo / (1 - margem/100).
export function calculateSafetyFloorPrice(costPrice: number, minimumMarginPct: number): number {
  return costPrice / (1 - minimumMarginPct / 100);
}

// O "piso financeiro" do TENANT: o menor preço que, depois de pagar o
// imposto (taxRate) e garantir a margem líquida mínima global
// (minProfitMargin), ainda cobre o custo de aquisição — fórmula pedida
// explicitamente: FloorPrice = custo / (1 - (taxRate + minProfitMargin)).
// taxRate/minProfitMargin são FRAÇÕES (0 a <1), não percentuais — ver
// PricingContext.
export function calculateFinancialFloorPrice(costPrice: number, taxRate: number, minProfitMargin: number): number {
  return costPrice / (1 - (taxRate + minProfitMargin));
}

// Trava de MAP — DIFERENTE das duas de cima (Safety Lock de margem): nunca
// jogamos fora nem "corrigimos silenciosamente" um preço que fura o MAP na
// hora de efetivamente ENVIAR ao marketplace, jogamos uma exceção. É a
// última linha de defesa, pedida explicitamente para ser chamada "antes de
// qualquer chamada para a API de precificação" — ver
// PricingDecisionService.dispatchDecision. Em condições normais NUNCA deve
// disparar (o piso de MAP já foi aplicado antes, tanto dentro do
// PricingStrategist quanto na defesa em profundidade de
// PricingDecisionService.resolveDecision) — é um assert de "isso não pode
// escapar", não um caminho de negócio esperado.
export class MapPriceViolationError extends Error {
  constructor(
    public readonly skuCode: string,
    public readonly attemptedPrice: number,
    public readonly mapPrice: number,
  ) {
    super(
      `SKU ${skuCode}: preço ${attemptedPrice.toFixed(2)} está abaixo do MAP (Preço Mínimo Anunciado) de ` +
        `${mapPrice.toFixed(2)} definido pelo fornecedor — bloqueado antes do envio ao marketplace. ` +
        'Em hipótese alguma o Kyneti envia um preço abaixo do MAP.',
    );
    this.name = 'MapPriceViolationError';
  }
}

export function validatePriceAgainstMap(skuCode: string, price: number, mapPrice: number | null): void {
  if (mapPrice !== null && price < mapPrice) {
    throw new MapPriceViolationError(skuCode, price, mapPrice);
  }
}

export function validatePricingContext(context: PricingContext): void {
  if (context.costPrice <= 0) throw new InvalidPricingContextError('costPrice precisa ser maior que zero.');
  if (context.currentPrice <= 0) throw new InvalidPricingContextError('currentPrice precisa ser maior que zero.');
  if (context.minimumMarginPct < 0 || context.minimumMarginPct >= 100) {
    throw new InvalidPricingContextError('minimumMarginPct precisa estar entre 0 (inclusive) e 100 (exclusive).');
  }
  if (context.desiredMarginPct < 0 || context.desiredMarginPct >= 100) {
    throw new InvalidPricingContextError('desiredMarginPct precisa estar entre 0 (inclusive) e 100 (exclusive).');
  }
  if (context.taxRate < 0 || context.minProfitMargin < 0) {
    throw new InvalidPricingContextError('taxRate e minProfitMargin não podem ser negativos.');
  }
  if (context.taxRate + context.minProfitMargin >= 1) {
    throw new InvalidPricingContextError(
      `taxRate (${context.taxRate}) + minProfitMargin (${context.minProfitMargin}) precisa ser menor que 1 — do contrário o piso financeiro é indefinido ou negativo.`,
    );
  }
  if (context.competitorBestPrice !== null && context.competitorBestPrice <= 0) {
    throw new InvalidPricingContextError('competitorBestPrice, quando presente, precisa ser maior que zero.');
  }
  if (context.mapPrice !== null && context.mapPrice <= 0) {
    throw new InvalidPricingContextError('mapPrice, quando presente, precisa ser maior que zero.');
  }
}
