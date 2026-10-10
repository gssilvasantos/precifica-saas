// Planejador "Buy Box + Campanhas" para anúncios de CATÁLOGO do Mercado Livre
// (07/10/2026, a pedido do Gui). Automatiza a rotina que ele fazia à mão no
// Mercado Turbo, anúncio por anúncio:
//
//   1. Sem estoque → não mexe.
//   2. Olha o preço da buy box (price_to_win do ML).
//   3. Para cada campanha do vendedor / tradicional disponível (Outubro,
//      Novembro, Dezembro, 10.10, 11.11...), escolhe o preço promocional:
//        a) preço da buy box (limitado à faixa que o ML aceita na campanha),
//           SE a margem de contribuição nesse preço ficar >= margem mínima;
//        b) senão, mantém o preço que o anúncio já pratica hoje, SE ele ainda
//           der margem >= mínima;
//        c) senão, não entra na campanha.
//
// Margem de contribuição = (preço − custo − imposto − tarifa ML − frete ML)
// ÷ preço — a MESMA conta que o Mercado Turbo mostra na coluna "M.C."
// (conferida contra dois casos reais do vídeo do Gui, ver spec).
//
// Domínio puro: nenhum I/O. A camada de aplicação busca tarifa/frete para os
// preços candidatos (candidatePrices) e entrega aqui uma função síncrona.

export type BuyBoxStatus = 'winning' | 'sharing_first_place' | 'competing' | 'listed' | 'unknown';

export interface CampaignOption {
  promotionId: string;
  promotionType: string; // SELLER_CAMPAIGN, DEAL, SMART, PRICE_DISCOUNT...
  name: string | null;
  status: string; // candidate | started | pending | finished ...
  currentDealPrice: number | null; // preço já cadastrado na campanha (se já participa)
  // Faixa de preço que o ML aceita nesta campanha para este anúncio. O ML
  // devolve como min_discounted_price / max_discounted_price, mas a
  // semântica (desconto vs. preço) já confundiu até o Mercado Turbo, então
  // o planejador só confia em "o maior e o menor dos dois".
  allowedPriceA: number | null;
  allowedPriceB: number | null;
  startDate: string | null;
  finishDate: string | null;
}

export interface MarginBreakdown {
  price: number;
  costPrice: number;
  taxAmount: number;
  feeAmount: number;
  freightAmount: number;
  marginAmount: number;
  marginPct: number; // sobre o preço de venda, em % (5 = 5%)
}

export interface CatalogItemSnapshot {
  itemId: string;
  availableQuantity: number;
  // Preço que o comprador vê hoje (já com promoção, se houver).
  currentSellingPrice: number;
  buyBoxStatus: BuyBoxStatus;
  // Preço para ganhar a buy box (price_to_win). null = ML não informou
  // (anúncio "listed", sem concorrência, etc.).
  priceToWin: number | null;
}

// Tipos que o Gui coloca na rotina: Campanha do Vendedor e Campanha
// Tradicional. Smart/co-participação, cupom e oferta relâmpago ficam fora
// por padrão (Smart foi justamente o exemplo de "margem negativa" no vídeo).
export const DEFAULT_ELIGIBLE_PROMOTION_TYPES = ['SELLER_CAMPAIGN', 'DEAL'] as const;

export type CampaignAction =
  | 'JOIN' // entrar na campanha com plannedPrice
  | 'ALREADY_IN' // já participa — nada a fazer
  | 'LOWER_SUGGESTED' // já participa, mas um preço menor ganharia a buy box com margem OK
  | 'SKIP_MARGIN' // nenhum preço possível respeita a margem mínima
  | 'SKIP_MAP' // todo preço possível ficaria abaixo do MAP (preço mínimo da marca) do SKU
  | 'SKIP_NOT_ELIGIBLE'; // tipo de campanha fora da rotina, ou status que não aceita adesão

export type PriceReason = 'BUY_BOX' | 'KEEP_CURRENT_PRICE' | null;

export interface CampaignPlan {
  promotionId: string;
  promotionType: string;
  name: string | null;
  status: string;
  action: CampaignAction;
  plannedPrice: number | null;
  priceReason: PriceReason;
  margin: MarginBreakdown | null;
  note: string;
}

export interface ItemPlan {
  itemId: string;
  skipped: boolean;
  skipReason: string | null;
  buyBoxStatus: BuyBoxStatus;
  currentSellingPrice: number;
  priceToWin: number | null;
  buyBoxTarget: number | null; // preço-alvo da buy box antes de limitar à faixa da campanha
  minMarginPct: number;
  campaigns: CampaignPlan[];
}

export class InvalidPlanInputError extends Error {}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Preço da buy box arredondado PARA BAIXO no centavo: arredondar para cima
// poderia deixar o anúncio 1 centavo acima do concorrente e não ganhar.
function floor2(value: number): number {
  return Math.floor(value * 100 + 1e-6) / 100;
}

export function allowedRange(option: CampaignOption): { low: number | null; high: number | null } {
  const values = [option.allowedPriceA, option.allowedPriceB].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
  );
  if (values.length === 0) return { low: null, high: null };
  return { low: Math.min(...values), high: Math.max(...values) };
}

// Preço que ganharia (ou mantém) a buy box. Ganhando ou empatado em 1º →
// mantém o preço atual. Perdendo com price_to_win → esse preço. Sem dado →
// null (o planejador cai direto no "manter preço atual").
export function buyBoxTargetPrice(item: CatalogItemSnapshot): number | null {
  if (item.buyBoxStatus === 'winning' || item.buyBoxStatus === 'sharing_first_place') {
    return round2(item.currentSellingPrice);
  }
  if (item.priceToWin !== null && item.priceToWin > 0) {
    return floor2(item.priceToWin);
  }
  return null;
}

// Ajusta um preço desejado à faixa aceita pela campanha. Acima do teto →
// desce para o teto (é o que o ML exige; e preço menor só ajuda a ganhar).
// Abaixo do piso → impossível (devolve null).
function fitToRange(desired: number, range: { low: number | null; high: number | null }): number | null {
  let price = desired;
  if (range.high !== null && price > range.high) price = range.high;
  if (range.low !== null && price < range.low - 0.005) return null;
  return round2(price);
}

function isEligible(option: CampaignOption, eligibleTypes: readonly string[]): boolean {
  return eligibleTypes.includes(option.promotionType.toUpperCase());
}

function isAlreadyIn(option: CampaignOption): boolean {
  return ['started', 'pending'].includes(option.status.toLowerCase());
}

function isJoinable(option: CampaignOption): boolean {
  return option.status.toLowerCase() === 'candidate';
}

// Todos os preços para os quais a aplicação precisa calcular margem antes de
// chamar planItem. Mantém a quantidade de chamadas de tarifa/frete ao ML no
// mínimo (normalmente 1 a 3 preços distintos por anúncio).
export function candidatePrices(
  item: CatalogItemSnapshot,
  options: CampaignOption[],
  eligibleTypes: readonly string[] = DEFAULT_ELIGIBLE_PROMOTION_TYPES,
): number[] {
  const target = buyBoxTargetPrice(item);
  const prices = new Set<number>();
  for (const option of options) {
    if (!isEligible(option, eligibleTypes)) continue;
    const range = allowedRange(option);
    if (target !== null) {
      const fitted = fitToRange(target, range);
      if (fitted !== null) prices.add(fitted);
    }
    const keep = fitToRange(item.currentSellingPrice, range);
    if (keep !== null) prices.add(keep);
  }
  return [...prices].sort((a, b) => a - b);
}

export function planItem(
  item: CatalogItemSnapshot,
  options: CampaignOption[],
  marginAt: (price: number) => MarginBreakdown,
  minMarginPct: number,
  eligibleTypes: readonly string[] = DEFAULT_ELIGIBLE_PROMOTION_TYPES,
  // MAP do SKU (Product.mapPrice). null = sem restrição. Preço abaixo do MAP
  // nunca é escolhido: o planejador cai no outro preço possível ou pula.
  mapPrice: number | null = null,
): ItemPlan {
  if (!(minMarginPct >= 0)) {
    throw new InvalidPlanInputError('minMarginPct deve ser >= 0.');
  }
  if (!(item.currentSellingPrice > 0)) {
    throw new InvalidPlanInputError(`Anúncio ${item.itemId} sem preço atual válido.`);
  }

  const target = buyBoxTargetPrice(item);
  const base: Omit<ItemPlan, 'campaigns' | 'skipped' | 'skipReason'> = {
    itemId: item.itemId,
    buyBoxStatus: item.buyBoxStatus,
    currentSellingPrice: item.currentSellingPrice,
    priceToWin: item.priceToWin,
    buyBoxTarget: target,
    minMarginPct,
  };

  if (item.availableQuantity <= 0) {
    return { ...base, skipped: true, skipReason: 'Sem estoque — preço não é alterado.', campaigns: [] };
  }

  const campaigns = options.map((option): CampaignPlan => {
    const head = {
      promotionId: option.promotionId,
      promotionType: option.promotionType,
      name: option.name,
      status: option.status,
    };

    if (!isEligible(option, eligibleTypes)) {
      return { ...head, action: 'SKIP_NOT_ELIGIBLE', plannedPrice: null, priceReason: null, margin: null, note: `Tipo ${option.promotionType} fora da rotina.` };
    }

    const range = allowedRange(option);
    const buyBoxPrice = target !== null ? fitToRange(target, range) : null;
    const keepPrice = fitToRange(item.currentSellingPrice, range);

    const respectsMap = (price: number) => mapPrice === null || price >= mapPrice - 0.005;
    let chosen: { price: number; reason: PriceReason; margin: MarginBreakdown } | null = null;
    if (buyBoxPrice !== null && respectsMap(buyBoxPrice)) {
      const margin = marginAt(buyBoxPrice);
      if (margin.marginPct >= minMarginPct) chosen = { price: buyBoxPrice, reason: 'BUY_BOX', margin };
    }
    if (!chosen && keepPrice !== null && respectsMap(keepPrice)) {
      const margin = marginAt(keepPrice);
      if (margin.marginPct >= minMarginPct) chosen = { price: keepPrice, reason: 'KEEP_CURRENT_PRICE', margin };
    }

    if (isAlreadyIn(option)) {
      const current = option.currentDealPrice;
      if (chosen && chosen.reason === 'BUY_BOX' && current !== null && chosen.price < current - 0.005) {
        return {
          ...head,
          action: 'LOWER_SUGGESTED',
          plannedPrice: chosen.price,
          priceReason: chosen.reason,
          margin: chosen.margin,
          note: `Já participa a R$ ${current.toFixed(2)}; R$ ${chosen.price.toFixed(2)} ganharia a buy box com margem ${chosen.margin.marginPct.toFixed(2)}%.`,
        };
      }
      return {
        ...head,
        action: 'ALREADY_IN',
        plannedPrice: current,
        priceReason: null,
        margin: current !== null ? marginAt(current) : null,
        note: 'Já participa desta campanha.',
      };
    }

    if (!isJoinable(option)) {
      return { ...head, action: 'SKIP_NOT_ELIGIBLE', plannedPrice: null, priceReason: null, margin: null, note: `Status ${option.status} não aceita adesão.` };
    }

    if (!chosen) {
      const reference = buyBoxPrice ?? keepPrice;
      const candidates = [buyBoxPrice, keepPrice].filter((p): p is number => p !== null);
      if (mapPrice !== null && candidates.length > 0 && candidates.every((p) => !respectsMap(p))) {
        return {
          ...head,
          action: 'SKIP_MAP',
          plannedPrice: null,
          priceReason: null,
          margin: reference !== null ? marginAt(reference) : null,
          note: `Preço possível (R$ ${Math.max(...candidates).toFixed(2)}) fica abaixo do MAP de R$ ${mapPrice.toFixed(2)} do SKU — não entra.`,
        };
      }
      return {
        ...head,
        action: 'SKIP_MARGIN',
        plannedPrice: null,
        priceReason: null,
        margin: reference !== null ? marginAt(reference) : null,
        note:
          reference === null
            ? 'Nenhum preço possível dentro da faixa aceita pela campanha.'
            : `Margem abaixo de ${minMarginPct}% em qualquer preço possível.`,
      };
    }

    return {
      ...head,
      action: 'JOIN',
      plannedPrice: chosen.price,
      priceReason: chosen.reason,
      margin: chosen.margin,
      note:
        chosen.reason === 'BUY_BOX'
          ? 'Preço da buy box com margem dentro do mínimo.'
          : 'Buy box exigiria margem abaixo do mínimo — entra mantendo o preço atual.',
    };
  });

  return { ...base, skipped: false, skipReason: null, campaigns };
}

// Margem de contribuição no estilo Mercado Turbo. Imposto incide sobre o
// preço (por dentro); tarifa e frete vêm do próprio ML para aquele preço.
export function contributionMargin(input: {
  price: number;
  costPrice: number;
  taxRate: number; // fração (0.073 = 7,3%)
  feeAmount: number;
  freightAmount: number;
}): MarginBreakdown {
  const taxAmount = round2(input.price * input.taxRate);
  const marginAmount = round2(input.price - input.costPrice - taxAmount - input.feeAmount - input.freightAmount);
  return {
    price: input.price,
    costPrice: input.costPrice,
    taxAmount,
    feeAmount: round2(input.feeAmount),
    freightAmount: round2(input.freightAmount),
    marginAmount,
    marginPct: round2((marginAmount / input.price) * 100),
  };
}
