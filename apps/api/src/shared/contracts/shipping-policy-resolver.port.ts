// Porta exposta pelo Marketplace Intelligence, consumida pelo Pricing
// Intelligence — irmã da FeeRuleResolver, e separada dela de propósito.
//
// POR QUE SEPARADA: comissão é o que o canal cobra pela venda; frete é quem
// arca com a entrega. Os dois variam por faixa de preço, mas com limiares
// que não têm relação entre si — no Mercado Livre a comissão muda por
// categoria, enquanto o frete vira obrigação do vendedor exatamente em
// R$79, um número que independe de categoria. Fundir as duas regras num
// payload só obrigaria a repetir a tabela de comissão inteira toda vez que
// o limiar de frete mudasse.
//
// Ver docs/marketplace-fee-model-architecture.md, §2.0.

export interface ResolvedShippingBand {
  minPrice: number; // inclusive
  maxPrice: number | null; // exclusive; null = última faixa
  // O comprador vê frete grátis nesta faixa — o custo não desaparece, migra
  // para o vendedor no que o subsídio não cobrir.
  freeShippingRequired: boolean;
  channelSubsidyPct: number; // fração (0 a 1) do frete que o canal cobre
  channelSubsidyCapAmount: number | null; // teto em R$ do subsídio; null = sem teto
}

export interface ResolvedShippingPolicy {
  bands: ResolvedShippingBand[];
  ruleId: string;
  ruleVersion: number;
}

export class NoShippingBandForPriceError extends Error {
  constructor(price: number) {
    super(
      `Nenhuma faixa de frete cobre o preço ${price.toFixed(2)} — a política de frete do canal está incompleta. ` +
        'O validador exige faixas contíguas de 0 ao infinito, então isso indica regra corrompida.',
    );
    this.name = 'NoShippingBandForPriceError';
  }
}

export function shippingBandAtPrice(policy: ResolvedShippingPolicy, price: number): ResolvedShippingBand {
  const band = policy.bands.find((b) => price >= b.minPrice && (b.maxPrice === null || price < b.maxPrice));
  if (!band) throw new NoShippingBandForPriceError(price);
  return band;
}

// Quanto do frete sai do bolso do VENDEDOR, dado o preço de venda.
//
// `sellerReputationDiscountPct` (fração 0-1) modela o desconto que alguns
// canais dão por desempenho do vendedor — no Mercado Livre chega a 70% para
// reputação verde-escuro. É atributo da CONTA, não do produto nem do preço,
// por isso entra como parâmetro em vez de morar na regra: a mesma política
// do canal vale para todos os vendedores, o desconto é que muda.
//
// A ordem das operações importa: o subsídio percentual é limitado pelo teto
// ANTES do desconto de reputação, porque são coisas diferentes — o teto é
// quanto o canal aceita bancar, o desconto é um abatimento sobre o que
// sobrou para o vendedor.
export function resolveSellerFreightCost(
  policy: ResolvedShippingPolicy,
  price: number,
  freightCost: number,
  sellerReputationDiscountPct = 0,
): number {
  if (freightCost <= 0) return 0;

  const band = shippingBandAtPrice(policy, price);

  const rawSubsidy = freightCost * band.channelSubsidyPct;
  const cappedSubsidy =
    band.channelSubsidyCapAmount !== null ? Math.min(rawSubsidy, band.channelSubsidyCapAmount) : rawSubsidy;

  const sellerShare = Math.max(0, freightCost - cappedSubsidy);
  return sellerShare * (1 - sellerReputationDiscountPct);
}

export interface ShippingPolicyResolver {
  resolveShippingPolicy(params: {
    marketplaceCode: string;
    tenantId: string;
    atDate?: Date;
  }): Promise<ResolvedShippingPolicy | null>; // null = canal sem política cadastrada
}
