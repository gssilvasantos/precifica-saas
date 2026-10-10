import { buildCatalogItemPayload, extractGtin, solvePriceForMargin } from './ml-catalog-listing-creation';

// Tarifa realista do ML: 13% + R$ 6,00 fixos (faixa < R$ 79).
const feeAt = async (price: number) => Math.round((price * 0.13 + (price < 79 ? 6 : 0)) * 100) / 100;

describe('solvePriceForMargin', () => {
  it('acha preço com margem >= 40% (custo 32,64, imposto 7,3%, frete 8,15)', async () => {
    const r = await solvePriceForMargin({ costPrice: 32.64, taxRate: 0.073, freightAmount: 8.15, targetMarginPct: 40, feeAt });
    expect(r.marginPct).toBeGreaterThanOrEqual(40);
    expect(r.marginPct).toBeLessThan(40.5);
    expect(r.marginAmount).toBeCloseTo(r.price - 32.64 - r.taxAmount - r.feeAmount - 8.15, 2);
  });

  it('é o menor preço em centavos: um centavo a menos fica abaixo de 40%', async () => {
    const r = await solvePriceForMargin({ costPrice: 20, taxRate: 0.1, freightAmount: 5, targetMarginPct: 40, feeAt });
    const p = Math.round((r.price - 0.01) * 100) / 100;
    const fee = await feeAt(p);
    const margin = p - 20 - Math.round(p * 0.1 * 100) / 100 - fee - 5;
    expect(margin / p).toBeLessThan(0.4);
  });

  it('rejeita entradas inviáveis', async () => {
    await expect(solvePriceForMargin({ costPrice: 0, taxRate: 0.07, freightAmount: 0, targetMarginPct: 40, feeAt })).rejects.toThrow();
    await expect(solvePriceForMargin({ costPrice: 10, taxRate: 0.7, freightAmount: 0, targetMarginPct: 40, feeAt })).rejects.toThrow(/inviável/);
    await expect(solvePriceForMargin({ costPrice: 10, taxRate: 0.07, freightAmount: 0, targetMarginPct: 100, feeAt })).rejects.toThrow();
  });
});

describe('extractGtin', () => {
  it('lê GTIN e normaliza dígitos', () => {
    expect(extractGtin([{ id: 'GTIN', value_name: '7896016000799' }])).toBe('7896016000799');
    expect(extractGtin([{ id: 'GTIN', value_name: '789 601 6000799' }])).toBe('7896016000799');
  });
  it('usa EAN como fallback e recusa tamanho inválido ou ausência', () => {
    expect(extractGtin([{ id: 'EAN', value_name: '7908254900097' }])).toBe('7908254900097');
    expect(extractGtin([{ id: 'GTIN', value_name: '12345' }])).toBeNull();
    expect(extractGtin([])).toBeNull();
  });
});

describe('buildCatalogItemPayload', () => {
  it('monta anúncio de catálogo com estoque 1 e SKU', () => {
    const p = buildCatalogItemPayload({ catalogProductId: 'MLB1', categoryId: 'MLB9', price: 79.9, listingTypeId: 'gold_special', skuCode: 'RM0130' });
    expect(p).toMatchObject({ catalog_listing: true, catalog_product_id: 'MLB1', available_quantity: 1, attributes: [{ id: 'SELLER_SKU', value_name: 'RM0130' }] });
  });
});
