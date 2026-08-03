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
  // Custo do produto SEM embalagem (ProductCatalogSummary.productCostPrice,
  // nunca `costPrice`) — a embalagem já está dentro de `logisticsCost`
  // abaixo. Usar o custo efetivo aqui contaria a embalagem DUAS vezes; é a
  // mesma disciplina de promotion-intelligence.service.ts (Sprint 26), que
  // já resolvia isso corretamente.
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

  // --- Custos do CANAL (01/08/2026 — ver docs/revisao-geral-2026-08.md, §1) ---
  //
  // Antes desta correção, NENHUM destes três campos existia: os pisos eram
  // calculados só sobre custo + imposto + margem, ignorando a comissão do
  // marketplace. O efeito era um "preço de segurança" que podia dar
  // PREJUÍZO real (exemplo do doc: custo 60, piso 20% => R$75; no Mercado
  // Livre com 14% + R$20 de frete, entram R$44,50 contra um custo de R$60).
  //
  // Princípio de produto (decisão do usuário, 01/08/2026): o sistema só
  // guarda como valor fixo o custo do produto, a alíquota de imposto e o
  // custo unitário da embalagem. TODA taxa de marketplace é IMPORTADA do
  // próprio canal (MarketplaceRule, alimentada por FeeRuleCapableProvider) —
  // nunca digitada, nunca estimada. Por isso não existe default aqui: quem
  // monta o contexto (PricingDecisionService) BLOQUEIA a decisão quando a
  // taxa ainda não foi importada, em vez de assumir zero.
  channelCode: string; // canal ao qual este cálculo se refere — taxa e logística variam por canal
  // TABELA de comissão do canal, não um escalar. Nenhum dos sete canais
  // mapeados cobra taxa constante — a Shopee cobra 20% até R$79,99 e 14%
  // acima, com taxa fixa de R$4 a R$26 conforme a faixa. Ver
  // docs/marketplace-fee-model-architecture.md.
  feeTiers: TieredFeeInput[];
  // Teto de comissão por item, quando o canal aplica. null = sem teto.
  commissionCapAmount: number | null;
  // Preço a partir do qual o frete grátis é obrigatório neste canal.
  // Informativo (o efeito já está em feeTiers[].sellerFreightCost) — serve
  // para a decisão explicar o degrau ao usuário.
  freeShippingThreshold: number | null;
  // Embalagem (hierarquia kit/individual/default) + custo operacional do
  // armazém do canal, já composto pelo LogisticsCostReader. Ver
  // shared/contracts/logistics-cost-reader.port.ts.
  logisticsCost: number;
  // Rastreabilidade: qual MarketplaceRule (versionada, validada) forneceu a
  // comissão acima. Ecoado na decisão para auditoria — nunca usado no
  // cálculo. null só nos testes/simulações que montam o contexto à mão.
  feeRuleId: string | null;
  feeRuleVersion: number | null;
  // Custo EFETIVO no sentido antigo (produto + embalagem) — o valor que o
  // motor usava como `costPrice` antes de 01/08/2026. Existe unicamente
  // para reproduzir o piso da fórmula antiga no breakdown e permitir o
  // comparativo "antes x depois" na tela. Não participa de nenhum cálculo
  // de decisão. Some junto com legacyFloorPriceForComparison quando a
  // migração estiver consolidada.
  effectiveCostPriceLegacy: number;

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

// Detalhamento do que foi descontado para chegar à margem — existe para
// que a decisão seja AUDITÁVEL, não uma caixa-preta: com estes campos a
// tela consegue mostrar "seu piso subiu de X para Y porque a comissão do
// canal é Z%", que é exatamente o modo simulação pedido antes de ligar a
// correção em produção. Todos vêm de fonte externa (comissão importada do
// marketplace, logística composta pelo Logistics Fulfillment) — nenhum é
// estimado aqui dentro.
export interface PricingCostBreakdown {
  channelCode: string;
  commissionPct: number;
  fixedFeeAmount: number;
  logisticsCost: number;
  taxRate: number;
  // Frete que o vendedor paga no preço recomendado, já com subsídio do
  // canal e desconto de reputação. Exposto separado de logisticsCost para a
  // tela conseguir dizer "acima de R$79 o frete passa a ser seu" — que é a
  // informação que o lojista precisa ver, não um total agregado.
  sellerFreightCost: number;
  // true quando o preço recomendado cai numa faixa de frete grátis
  // obrigatório. Vale mostrar mesmo quando sellerFreightCost é 0 (canal
  // cobrindo tudo hoje), porque é uma política que pode mudar.
  freeShippingRequired: boolean;
  // Qual MarketplaceRule respondeu pela comissão — rastreabilidade até a
  // regra versionada que o Marketplace Intelligence importou e validou.
  feeRuleId: string | null;
  feeRuleVersion: number | null;
  // Preço a partir do qual o frete grátis vira obrigatório (ML: R$79).
  // null quando o canal não tem limiar ou não há política cadastrada.
  freeShippingThreshold: number | null;
  // Piso que a fórmula ANTIGA (só custo/margem, sem comissão nem logística)
  // teria produzido. Não é usado em nenhuma decisão — existe só para a UI
  // conseguir mostrar o "antes x depois" durante a transição. Remover
  // quando a migração estiver consolidada e ninguém mais precisar comparar.
  legacyFloorPriceForComparison: number;
}

export interface PricingDecision {
  skuCode: string;
  action: PricingAction;
  recommendedPrice: number;
  currentPrice: number;
  // Margem LÍQUIDA resultante (depois de comissão, imposto e logística) —
  // antes de 01/08/2026 este campo era margem bruta, o que fazia um preço
  // deficitário aparecer como saudável na UI.
  resultingMarginPct: number;
  safetyFloorPrice: number; // piso por produto (minimumMarginPct) — sempre calculado, mesmo quando não é o vigente
  financialFloorPrice: number; // piso financeiro do tenant (imposto + margem mínima global) — idem
  hitSafetyFloor: boolean;
  hitFinancialFloor: boolean;
  costs: PricingCostBreakdown;
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

// Custos que dependem do CANAL, agrupados para as funções de piso não
// receberem 5 parâmetros soltos na ordem errada. Todos vêm importados do
// marketplace (comissão) ou compostos por outro módulo (logística) — nunca
// digitados por quem chama.
export interface ChannelCosts {
  commissionPct: number; // fração (0 a <1)
  fixedFeeAmount: number;
  logisticsCost: number; // embalagem + operação de armazém
  taxRate: number; // fração (0 a <1)
  // Frete pago pelo VENDEDOR neste preço (0 quando o canal cobre). Separado
  // de logisticsCost porque tem origem diferente (política do canal, não
  // custo interno) e porque só ele varia com o preço.
  sellerFreightCost: number;
}

// Margem LÍQUIDA sobre o PREÇO DE VENDA, em % — a mesma definição que
// promotion-intelligence/domain/margin-calculator.ts (calculateNetMargin)
// já usava: preço - comissão - taxa fixa - imposto - custo - logística.
//
// ATENÇÃO (01/08/2026): até esta data existia aqui um `marginPctOf(price,
// costPrice)` que fazia só (preço - custo)/preço, ignorando comissão,
// imposto e logística. O comentário antigo afirmava ser "a mesma convenção"
// do calculateNetMargin das Promoções — era verdade apenas quanto ao
// DENOMINADOR (as duas medem sobre o preço de venda); o numerador era
// completamente diferente (bruto vs. líquido), e era exatamente isso que
// fazia o motor de repricing achar seguro um preço que dava prejuízo.
// Agora as duas fórmulas são de fato equivalentes.
export function netMarginPctOf(price: number, costPrice: number, costs: ChannelCosts): number {
  if (price <= 0) return -Infinity;
  const fees = price * costs.commissionPct + costs.fixedFeeAmount;
  const tax = price * costs.taxRate;
  return (
    ((price - fees - tax - costPrice - costs.logisticsCost - costs.sellerFreightCost) / price) * 100
  );
}

// Lançada quando a margem pedida é matematicamente inalcançável naquele
// canal — ex.: comissão 20% + imposto 10% + margem mínima 75% = 105%, não
// existe preço que satisfaça isso. Não é erro de programação: é um cenário
// de negócio real (produto que simplesmente não fecha naquele marketplace),
// e quem chama precisa tratá-lo como "não dá para precificar aqui", nunca
// silenciar com um número negativo ou infinito.
export class UnreachableMarginError extends Error {
  constructor(
    public readonly skuCode: string,
    public readonly targetMarginPct: number,
    public readonly channelCode: string,
  ) {
    super(
      `SKU ${skuCode}: margem de ${targetMarginPct.toFixed(1)}% é inalcançável no canal ${channelCode} — ` +
        'a soma de comissão + imposto + margem pedida chega a 100% ou mais do preço de venda. ' +
        'Reveja a margem configurada ou a viabilidade do produto neste canal.',
    );
    this.name = 'UnreachableMarginError';
  }
}

// Núcleo da correção de 01/08/2026: o menor preço cuja margem LÍQUIDA ainda
// atinge `targetMarginPct`. Derivado invertendo netMarginPctOf:
//
//   m = (P - (c·P + f) - (t·P) - custo - log) / P
//   m·P = P·(1 - c - t) - f - custo - log
//   P·(1 - c - t - m) = custo + log + f
//   P = (custo + log + f) / (1 - c - t - m)
//
// onde c = comissão, t = imposto, f = taxa fixa, m = margem alvo (frações).
//
// A fórmula antiga (custo / (1 - margem)) é o caso particular desta com
// c = t = f = log = 0 — ou seja, ela só estava correta para um canal sem
// comissão, sem imposto e sem custo logístico. Nenhum marketplace real é
// assim; a Nuvemshop (loja própria) é a que mais chega perto, e ainda tem
// taxa de gateway.
export function calculateNetMarginFloorPrice(
  costPrice: number,
  targetMarginPct: number,
  costs: ChannelCosts,
  skuCode: string,
  channelCode: string,
): number {
  const denominator = 1 - costs.commissionPct - costs.taxRate - targetMarginPct / 100;
  if (denominator <= 0) {
    throw new UnreachableMarginError(skuCode, targetMarginPct, channelCode);
  }
  return (costPrice + costs.logisticsCost + costs.fixedFeeAmount) / denominator;
}

// O "preço de segurança" POR PRODUTO: menor preço que ainda entrega
// minimumMarginPct de margem LÍQUIDA (não mais bruta — ver
// calculateNetMarginFloorPrice).
export function calculateSafetyFloorPrice(
  costPrice: number,
  minimumMarginPct: number,
  costs: ChannelCosts,
  skuCode: string,
  channelCode: string,
): number {
  return calculateNetMarginFloorPrice(costPrice, minimumMarginPct, costs, skuCode, channelCode);
}

// O "piso financeiro" do TENANT: mesma inversão, com a margem líquida
// mínima GLOBAL (minProfitMargin, fração) no lugar da margem do produto. O
// imposto continua entrando exatamente como antes — ele já fazia parte
// desta fórmula; o que mudou foi passar a descontar também comissão e
// logística, que antes ficavam de fora dos dois pisos.
export function calculateFinancialFloorPrice(
  costPrice: number,
  minProfitMargin: number,
  costs: ChannelCosts,
  skuCode: string,
  channelCode: string,
): number {
  return calculateNetMarginFloorPrice(costPrice, minProfitMargin * 100, costs, skuCode, channelCode);
}

// A faixa que vale para um preço concreto. Lança quando a tabela não cobre
// o preço — o validador de payload garante cobertura de 0 ao infinito, então
// isso só acontece se uma regra corrompida escapar da importação.
export function tierAtPrice(tiers: TieredFeeInput[], price: number): TieredFeeInput {
  const tier = tiers.find((t) => price >= t.minPrice && (t.maxPrice === null || price < t.maxPrice));
  if (!tier) {
    throw new InvalidPricingContextError(
      `nenhuma faixa de comissão cobre o preço ${price.toFixed(2)} — tabela de taxas do canal incompleta.`,
    );
  }
  return tier;
}

// Extrai o bloco de custos de canal PARA UM PREÇO — a comissão só é um
// número depois que se sabe em qual faixa o preço caiu. Antes das faixas
// existirem isso era um simples getter; agora é uma resolução.
export function channelCostsOf(context: PricingContext, price: number): ChannelCosts {
  const tier = tierAtPrice(context.feeTiers, price);
  return {
    commissionPct: tier.commissionPct,
    fixedFeeAmount: tier.fixedFeeAmount,
    logisticsCost: context.logisticsCost,
    taxRate: context.taxRate,
    sellerFreightCost: tier.sellerFreightCost,
  };
}

// ============================================================================
// Piso com TABELA DE FAIXAS — o problema circular
// (docs/marketplace-fee-model-architecture.md, §6)
// ============================================================================
//
// Quando a comissão varia por faixa de preço (Shopee cobra 20% até R$79,99 e
// 14% acima; ML tem limiar em R$79), o piso passa a ser circular: o preço
// depende da comissão, que depende da faixa, que depende do preço.
//
// Resolução: para CADA faixa, calcular o piso assumindo aquela faixa, e
// manter só as soluções CONSISTENTES — as que caem dentro da própria faixa
// que as gerou. Entre as consistentes, a MENOR vence (melhor para o
// vendedor). Isso é exato, não iterativo/aproximado: o número de faixas é
// pequeno e finito, então testar todas é mais simples e mais previsível que
// um laço de convergência (que poderia oscilar num limiar).

export interface TieredFeeInput {
  minPrice: number;
  maxPrice: number | null;
  commissionPct: number; // fração
  fixedFeeAmount: number;
  // Frete que o VENDEDOR paga nesta faixa de preço (já com subsídio do
  // canal e desconto de reputação aplicados por
  // resolveSellerFreightCost). Zero quando o canal cobre tudo — caso do
  // Mercado Livre entre R$19 e R$78,99 — ou quando ainda não há política
  // de frete nem estimativa de custo cadastradas.
  //
  // Está aqui, e não em ChannelCosts, porque VARIA POR FAIXA: é
  // exatamente o limiar de R$79 do ML, onde o frete salta de zero para
  // conta do vendedor. Tratá-lo como custo fixo apagaria o degrau.
  sellerFreightCost: number;
}

// Une os breakpoints das faixas de COMISSÃO com os das faixas de FRETE,
// produzindo segmentos em que os dois são constantes ao mesmo tempo.
//
// Sem isso haveria dois problemas circulares independentes se cruzando: o
// preço depende da comissão (que depende da faixa de preço) E do frete que
// o vendedor paga (que depende de outra faixa de preço, com limiares
// diferentes). Depois da união, volta a ser um problema só — testar cada
// segmento —, e o algoritmo de ponto fixo que já existe resolve sem mudança.
//
// `freightAt` é uma função porque o frete do vendedor depende do preço
// (a política resolve a faixa e aplica subsídio/teto); recebe o início do
// segmento, onde a política é constante por construção.
export function mergeFeeAndShippingBands(
  feeTiers: { minPrice: number; maxPrice: number | null; commissionPct: number; fixedFeeAmount: number }[],
  shippingBreakpoints: number[],
  freightAt: (priceInSegment: number) => number,
): TieredFeeInput[] {
  const boundaries = new Set<number>([0]);
  for (const tier of feeTiers) {
    boundaries.add(tier.minPrice);
    if (tier.maxPrice !== null) boundaries.add(tier.maxPrice);
  }
  for (const breakpoint of shippingBreakpoints) boundaries.add(breakpoint);

  const sorted = [...boundaries].sort((a, b) => a - b);

  return sorted.map((minPrice, index) => {
    const maxPrice = index < sorted.length - 1 ? sorted[index + 1] : null;
    const tier = feeTiers.find((t) => minPrice >= t.minPrice && (t.maxPrice === null || minPrice < t.maxPrice));

    if (!tier) {
      throw new InvalidPricingContextError(
        `nenhuma faixa de comissão cobre o segmento que começa em ${minPrice.toFixed(2)} — tabela de taxas incompleta.`,
      );
    }

    return {
      minPrice,
      maxPrice,
      commissionPct: tier.commissionPct,
      fixedFeeAmount: tier.fixedFeeAmount,
      sellerFreightCost: freightAt(minPrice),
    };
  });
}

export interface TieredFloorResult {
  floorPrice: number;
  // Faixa que de fato governa o piso — o chamador precisa dela para montar
  // o PricingContext com a comissão certa, e para explicar a decisão.
  appliedTier: TieredFeeInput;
  // true quando nenhuma faixa produziu solução consistente e o piso caiu
  // exatamente sobre um limiar de faixa (ver comentário em
  // resolveBoundaryFloor). Vale expor porque é um caso que merece atenção
  // ao revisar preço: o produto está bem no limite entre duas políticas de
  // taxa do canal.
  landedOnTierBoundary: boolean;
}

// Piso considerando a tabela inteira. `costs` traz imposto e logística (que
// não variam por faixa); comissão e taxa fixa vêm de cada faixa testada.
export function calculateTieredNetMarginFloorPrice(
  costPrice: number,
  targetMarginPct: number,
  tiers: TieredFeeInput[],
  costs: Pick<ChannelCosts, 'taxRate' | 'logisticsCost'>,
  skuCode: string,
  channelCode: string,
): TieredFloorResult {
  const consistent: { price: number; tier: TieredFeeInput }[] = [];

  for (const tier of tiers) {
    const denominator = 1 - tier.commissionPct - costs.taxRate - targetMarginPct / 100;
    if (denominator <= 0) continue; // margem inalcançável NESTA faixa — outra ainda pode servir

    // O frete do vendedor entra no numerador junto com custo, logística e
    // taxa fixa: são todos valores absolutos que o preço precisa cobrir
    // antes de sobrar margem. É o degrau de R$79 do ML aparecendo aqui.
    const price =
      (costPrice + costs.logisticsCost + tier.fixedFeeAmount + tier.sellerFreightCost) / denominator;

    const withinOwnTier = price >= tier.minPrice && (tier.maxPrice === null || price < tier.maxPrice);
    if (withinOwnTier) consistent.push({ price, tier });
  }

  if (consistent.length > 0) {
    const best = consistent.reduce((a, b) => (a.price <= b.price ? a : b));
    return { floorPrice: best.price, appliedTier: best.tier, landedOnTierBoundary: false };
  }

  return resolveBoundaryFloor(costPrice, targetMarginPct, tiers, costs, skuCode, channelCode);
}

// Caso sem solução consistente: acontece perto de um limiar, quando toda
// faixa produz um preço fora de si mesma (ex.: assumindo a faixa barata o
// preço "estoura" para cima dela; assumindo a cara, ele "cai" para baixo).
// Nesse cenário o piso real é o próprio LIMIAR — o menor preço de fronteira
// em que a margem já fecha. Testar os limiares é exato pelo mesmo motivo de
// antes: são poucos e conhecidos.
function resolveBoundaryFloor(
  costPrice: number,
  targetMarginPct: number,
  tiers: TieredFeeInput[],
  costs: Pick<ChannelCosts, 'taxRate' | 'logisticsCost'>,
  skuCode: string,
  channelCode: string,
): TieredFloorResult {
  const boundaries = tiers
    .map((t) => t.minPrice)
    .filter((p) => p > 0)
    .sort((a, b) => a - b);

  for (const boundary of boundaries) {
    const tier = tiers.find((t) => boundary >= t.minPrice && (t.maxPrice === null || boundary < t.maxPrice));
    if (!tier) continue;

    const marginAtBoundary = netMarginPctOf(boundary, costPrice, {
      commissionPct: tier.commissionPct,
      fixedFeeAmount: tier.fixedFeeAmount,
      logisticsCost: costs.logisticsCost,
      taxRate: costs.taxRate,
      sellerFreightCost: tier.sellerFreightCost,
    });

    if (marginAtBoundary >= targetMarginPct) {
      return { floorPrice: boundary, appliedTier: tier, landedOnTierBoundary: true };
    }
  }

  // Nenhuma faixa e nenhum limiar entregam a margem pedida: o produto não
  // fecha neste canal com esta margem. Dizer isso é a resposta honesta —
  // devolver "o melhor esforço" seria inventar um preço que não cumpre a
  // política que o próprio usuário configurou.
  throw new UnreachableMarginError(skuCode, targetMarginPct, channelCode);
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
  if (context.feeTiers.length === 0) {
    throw new InvalidPricingContextError('feeTiers precisa ter pelo menos uma faixa de comissão.');
  }
  for (const tier of context.feeTiers) {
    if (tier.commissionPct < 0 || tier.commissionPct >= 1) {
      throw new InvalidPricingContextError(
        `commissionPct precisa estar entre 0 (inclusive) e 1 (exclusive) — recebido ${tier.commissionPct}. ` +
          'Lembre que é uma FRAÇÃO (0.14 para 14%), não um percentual.',
      );
    }
    if (tier.fixedFeeAmount < 0) {
      throw new InvalidPricingContextError('fixedFeeAmount não pode ser negativo.');
    }
  }
  if (context.logisticsCost < 0) {
    throw new InvalidPricingContextError('logisticsCost não pode ser negativo.');
  }
  // Diferente da versão anterior (que checava um único par comissão/margem),
  // aqui basta que EXISTA alguma faixa viável: um produto pode ser inviável
  // na faixa barata e perfeitamente viável na cara, e bloquear por causa da
  // primeira seria recusar um preço que existe. Se nenhuma faixa fecha,
  // quem lança é calculateTieredNetMarginFloorPrice, com UnreachableMarginError
  // — erro específico e explicável, não "contexto inválido".
  const anyTierViable = context.feeTiers.some(
    (tier) => tier.commissionPct + context.taxRate + context.minProfitMargin < 1,
  );
  if (!anyTierViable) {
    throw new InvalidPricingContextError(
      `nenhuma faixa de comissão deixa espaço para imposto (${context.taxRate}) + margem mínima global ` +
        `(${context.minProfitMargin}) — a soma passa de 100% do preço em todas elas.`,
    );
  }
  if (context.competitorBestPrice !== null && context.competitorBestPrice <= 0) {
    throw new InvalidPricingContextError('competitorBestPrice, quando presente, precisa ser maior que zero.');
  }
  if (context.mapPrice !== null && context.mapPrice <= 0) {
    throw new InvalidPricingContextError('mapPrice, quando presente, precisa ser maior que zero.');
  }
}
