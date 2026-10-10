// Criar anúncio de CATÁLOGO pelo EAN (09/10/2026) — regras puras, sem I/O.
// Contexto: o vendedor tem anúncios tradicionais sem ficha de catálogo; para
// cada um, cria-se um anúncio de catálogo novo (estoque 1, vinculado depois
// ao Olist pelo SKU) com preço inicial que rende 40% de margem. O preço de
// venda de verdade vem depois, de uma campanha. Ver
// docs/product/ml-catalogo-criar-por-ean.md.

export const DEFAULT_TARGET_MARGIN_PCT = 40;
export const INITIAL_STOCK = 1;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface MlAttributeLike {
  id?: string | null;
  value_name?: string | null;
}

// GTIN/EAN do anúncio tradicional: atributo GTIN, ou EAN como fallback.
// Só aceita 8, 12, 13 ou 14 dígitos (formatos válidos de GTIN).
export function extractGtin(attributes: MlAttributeLike[]): string | null {
  for (const id of ['GTIN', 'EAN']) {
    const raw = attributes.find((a) => a.id === id)?.value_name;
    if (!raw) continue;
    const digits = String(raw).replace(/\D/g, '');
    if ([8, 12, 13, 14].includes(digits.length)) return digits;
  }
  return null;
}

export interface PriceSolveInput {
  costPrice: number;
  taxRate: number; // fração
  freightAmount: number;
  targetMarginPct: number; // 40 = 40%
  // Tarifa de venda do ML para um preço (listing_prices) — injetada para o
  // domínio continuar puro e testável.
  feeAt: (price: number) => Promise<number>;
}

export interface PriceSolveResult {
  price: number;
  feeAmount: number;
  taxAmount: number;
  marginAmount: number;
  marginPct: number;
  iterations: number;
}

// Acha o menor preço (em centavos) com margem >= alvo. A tarifa depende do
// preço, então itera: P = (custo + frete + tarifa(P)) / (1 - imposto - alvo).
// Margem sobre o preço, igual ao Mercado Turbo. Ao final sobe centavo a
// centavo até a margem recalculada ficar >= alvo (arredondamento nunca deixa
// o preço abaixo do pedido).
export async function solvePriceForMargin(input: PriceSolveInput): Promise<PriceSolveResult> {
  const { costPrice, taxRate, freightAmount, targetMarginPct } = input;
  // Memoiza a tarifa por preço (09/10/2026): o ponto fixo, o ajuste fino e a
  // descida revisitam os mesmos centavos, e cada consulta é uma chamada ao ML.
  // Menos chamadas = menos chance de bater no limite do ML (403 visto em
  // produção no primeiro lote real).
  const feeCache = new Map<number, number>();
  const feeAt = async (price: number): Promise<number> => {
    const key = round2(price);
    const cached = feeCache.get(key);
    if (cached !== undefined) return cached;
    const fee = await input.feeAt(key);
    feeCache.set(key, fee);
    return fee;
  };
  const target = targetMarginPct / 100;
  if (!(costPrice > 0)) throw new Error('costPrice deve ser maior que zero.');
  if (taxRate < 0 || taxRate >= 1) throw new Error('taxRate fora de 0-1.');
  if (!(target > 0 && target < 1)) throw new Error('targetMarginPct deve estar entre 0 e 100 (exclusivo).');
  const denominator = 1 - taxRate - target;
  if (denominator <= 0) throw new Error('Imposto + margem alvo >= 100%: preço inviável.');

  const margin = async (price: number) => {
    const fee = await feeAt(price);
    const taxAmount = round2(price * taxRate);
    const marginAmount = round2(price - costPrice - taxAmount - fee - freightAmount);
    return { fee, taxAmount, marginAmount, marginPct: round2((marginAmount / price) * 100) };
  };

  let price = round2((costPrice + freightAmount) / denominator);
  let iterations = 0;
  for (; iterations < 6; iterations++) {
    const fee = await feeAt(price);
    const next = round2((costPrice + freightAmount + fee) / denominator);
    if (Math.abs(next - price) < 0.005) break;
    price = next;
  }
  // Ajuste fino: garante margem recalculada >= alvo (no máximo 200 centavos).
  let m = await margin(price);
  for (let i = 0; i < 200 && m.marginAmount / price < target - 1e-9; i++) {
    price = round2(price + 0.01);
    m = await margin(price);
  }
  if (m.marginAmount / price < target - 1e-9) {
    throw new Error('Não convergiu para a margem alvo.');
  }
  // A tarifa tem degrau (ex.: taxa fixa abaixo de R$ 79), então o ponto fixo
  // pode oscilar e parar acima do mínimo. Desce centavo a centavo enquanto o
  // preço imediatamente menor ainda cumpre a margem (no máximo 1000 centavos).
  for (let i = 0; i < 1000; i++) {
    const lower = round2(price - 0.01);
    if (lower <= 0) break;
    const ml = await margin(lower);
    if (ml.marginAmount / lower < target - 1e-9) break;
    price = lower;
    m = ml;
  }
  return {
    price,
    feeAmount: round2(m.fee),
    taxAmount: m.taxAmount,
    marginAmount: m.marginAmount,
    marginPct: m.marginPct,
    iterations,
  };
}

export interface CatalogItemPayloadInput {
  catalogProductId: string;
  categoryId: string;
  price: number;
  listingTypeId: string;
  skuCode: string;
}

// Corpo do POST /items de um anúncio de catálogo. Título, fotos e atributos
// vêm da ficha do catálogo; só o que é do vendedor vai aqui. Formato NÃO
// exercitado contra o ML real — ver doc, seção de limitações.
export function buildCatalogItemPayload(input: CatalogItemPayloadInput) {
  return {
    category_id: input.categoryId,
    catalog_product_id: input.catalogProductId,
    catalog_listing: true,
    price: input.price,
    currency_id: 'BRL',
    available_quantity: INITIAL_STOCK,
    buying_mode: 'buy_it_now' as const,
    condition: 'new' as const,
    listing_type_id: input.listingTypeId,
    attributes: [{ id: 'SELLER_SKU', value_name: input.skuCode }],
  };
}
