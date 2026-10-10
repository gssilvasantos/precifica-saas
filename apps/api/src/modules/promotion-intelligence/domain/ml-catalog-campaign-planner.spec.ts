import {
  CampaignOption,
  CatalogItemSnapshot,
  candidatePrices,
  contributionMargin,
  planItem,
  buyBoxTargetPrice,
  InvalidPlanInputError,
} from './ml-catalog-campaign-planner';

// Casos de referência tirados da gravação de tela do Gui no Mercado Turbo
// (07/10/2026). Os valores esperados de margem são os que a coluna "M.C." do
// Mercado Turbo mostrou — o planejador tem que bater com eles.
const TAX = 0.073; // imposto aplicado pelo Mercado Turbo nos dois casos
const ML_COMMISSION = 0.13; // tarifa de venda observada (R$ 7,27 em R$ 55,90; R$ 6,07 em R$ 46,66)

function marginFn(costPrice: number, freight: number) {
  return (price: number) =>
    contributionMargin({ price, costPrice, taxRate: TAX, feeAmount: price * ML_COMMISSION, freightAmount: freight });
}

function campaign(overrides: Partial<CampaignOption> = {}): CampaignOption {
  return {
    promotionId: 'P-MLB-DEZ',
    promotionType: 'SELLER_CAMPAIGN',
    name: 'Campanha Dezembro',
    status: 'candidate',
    currentDealPrice: null,
    allowedPriceA: null,
    allowedPriceB: null,
    startDate: null,
    finishDate: null,
    ...overrides,
  };
}

describe('contributionMargin', () => {
  it('reproduz a M.C. do Mercado Turbo — Batom Maria Clara a R$ 55,90 (R$ 3,76)', () => {
    const m = marginFn(32.64, 8.15)(55.9);
    expect(m.feeAmount).toBe(7.27);
    expect(m.marginAmount).toBe(3.76);
    expect(m.marginPct).toBeCloseTo(6.73, 1);
  });

  it('reproduz a M.C. do Mercado Turbo — Batom Maria Clara a R$ 52,40 (R$ 0,97 / 1,85%)', () => {
    const m = marginFn(32.64, 8.15)(52.4);
    expect(m.marginAmount).toBe(0.97);
    expect(m.marginPct).toBeCloseTo(1.85, 1);
  });

  it('reproduz a M.C. do Mercado Turbo — Corretivo Amarelo a R$ 46,66 (R$ 7,82)', () => {
    const m = marginFn(22.51, 6.85)(46.66);
    expect(m.feeAmount).toBe(6.07);
    expect(m.marginAmount).toBe(7.82);
  });
});

describe('planItem', () => {
  describe('MAP (preço mínimo da marca)', () => {
    const corretivo: CatalogItemSnapshot = {
      itemId: 'MLB6987841986',
      availableQuantity: 7,
      currentSellingPrice: 49.12,
      buyBoxStatus: 'competing',
      priceToWin: 47.58,
    };
    const faixa = [campaign({ allowedPriceA: 46.66, allowedPriceB: 15.02 })];

    it('preço da buy box abaixo do MAP: cai para o preço atual, se este respeita o MAP', () => {
      const larga = [campaign({ allowedPriceA: 60, allowedPriceB: 15.02 })];
      const plan = planItem(corretivo, larga, marginFn(22.51, 6.85), 5, undefined, 48);
      expect(plan.campaigns[0].action).toBe('JOIN');
      expect(plan.campaigns[0].plannedPrice).toBe(49.12);
      expect(plan.campaigns[0].priceReason).toBe('KEEP_CURRENT_PRICE');
    });

    it('todo preço possível abaixo do MAP: SKIP_MAP, nunca entra', () => {
      const plan = planItem(corretivo, faixa, marginFn(22.51, 6.85), 5, undefined, 60);
      expect(plan.campaigns[0].action).toBe('SKIP_MAP');
      expect(plan.campaigns[0].plannedPrice).toBeNull();
      expect(plan.campaigns[0].note).toMatch(/MAP de R\$ 60\.00/);
    });

    it('preço exatamente igual ao MAP é aceito (mínimo inclusivo)', () => {
      const plan = planItem(corretivo, faixa, marginFn(22.51, 6.85), 5, undefined, 46.66);
      expect(plan.campaigns[0].plannedPrice).toBe(46.66);
    });

    it('sem MAP (null) o resultado é idêntico ao de antes', () => {
      const a = planItem(corretivo, faixa, marginFn(22.51, 6.85), 5);
      const b = planItem(corretivo, faixa, marginFn(22.51, 6.85), 5, undefined, null);
      expect(b).toEqual(a);
    });
  });

  it('Corretivo perdendo a buy box: entra pelo preço máximo aceito pela campanha, abaixo do price_to_win, com margem OK', () => {
    const item: CatalogItemSnapshot = {
      itemId: 'MLB6987841986',
      availableQuantity: 7,
      currentSellingPrice: 49.12,
      buyBoxStatus: 'competing',
      priceToWin: 47.58,
    };
    // Faixa mostrada pelo Mercado Turbo: "Mínimo R$ 46,66 · Máximo R$ 15,02".
    const options = [campaign({ allowedPriceA: 46.66, allowedPriceB: 15.02 })];

    const plan = planItem(item, options, marginFn(22.51, 6.85), 5);

    expect(plan.skipped).toBe(false);
    expect(plan.campaigns[0].action).toBe('JOIN');
    expect(plan.campaigns[0].plannedPrice).toBe(46.66);
    expect(plan.campaigns[0].priceReason).toBe('BUY_BOX');
    expect(plan.campaigns[0].margin?.marginAmount).toBe(7.82);
  });

  it('Batom: buy box daria 1,85% (< 5%) — entra mantendo o preço atual de R$ 55,90 (6,73%)', () => {
    const item: CatalogItemSnapshot = {
      itemId: 'MLB7393870900',
      availableQuantity: 11,
      currentSellingPrice: 55.9,
      buyBoxStatus: 'competing',
      priceToWin: 52.4,
    };
    const options = [campaign({ allowedPriceA: 66.4, allowedPriceB: 13.98 })];

    const plan = planItem(item, options, marginFn(32.64, 8.15), 5);

    expect(plan.campaigns[0].action).toBe('JOIN');
    expect(plan.campaigns[0].plannedPrice).toBe(55.9);
    expect(plan.campaigns[0].priceReason).toBe('KEEP_CURRENT_PRICE');
  });

  it('sem estoque: pula o anúncio inteiro', () => {
    const plan = planItem(
      { itemId: 'X', availableQuantity: 0, currentSellingPrice: 39.27, buyBoxStatus: 'competing', priceToWin: 36.5 },
      [campaign()],
      marginFn(21.22, 6.85),
      5,
    );
    expect(plan.skipped).toBe(true);
    expect(plan.campaigns).toEqual([]);
  });

  it('nenhum preço respeita a margem mínima: SKIP_MARGIN, nunca entra', () => {
    const plan = planItem(
      { itemId: 'X', availableQuantity: 3, currentSellingPrice: 40, buyBoxStatus: 'competing', priceToWin: 30 },
      [campaign()],
      marginFn(35, 6),
      5,
    );
    expect(plan.campaigns[0].action).toBe('SKIP_MARGIN');
    expect(plan.campaigns[0].plannedPrice).toBeNull();
  });

  it('exatamente 5% é aceito (mínimo inclusivo)', () => {
    const fixed = (price: number) => ({
      price, costPrice: 0, taxAmount: 0, feeAmount: 0, freightAmount: 0, marginAmount: price * 0.05, marginPct: 5,
    });
    const plan = planItem(
      { itemId: 'X', availableQuantity: 1, currentSellingPrice: 50, buyBoxStatus: 'competing', priceToWin: 48 },
      [campaign()],
      fixed,
      5,
    );
    expect(plan.campaigns[0].action).toBe('JOIN');
    expect(plan.campaigns[0].plannedPrice).toBe(48);
  });

  it('ganhando a buy box: entra mantendo o preço atual', () => {
    const plan = planItem(
      { itemId: 'X', availableQuantity: 5, currentSellingPrice: 46.66, buyBoxStatus: 'winning', priceToWin: null },
      [campaign({ allowedPriceA: 46.66 })],
      marginFn(22.51, 6.85),
      5,
    );
    expect(plan.campaigns[0].action).toBe('JOIN');
    expect(plan.campaigns[0].plannedPrice).toBe(46.66);
    expect(plan.campaigns[0].priceReason).toBe('BUY_BOX');
  });

  it('buy box abaixo do piso aceito pela campanha: não alcança, cai para manter preço atual', () => {
    const plan = planItem(
      { itemId: 'X', availableQuantity: 5, currentSellingPrice: 60, buyBoxStatus: 'competing', priceToWin: 20 },
      [campaign({ allowedPriceA: 30, allowedPriceB: 70 })],
      marginFn(25, 6),
      5,
    );
    expect(plan.campaigns[0].priceReason).toBe('KEEP_CURRENT_PRICE');
    expect(plan.campaigns[0].plannedPrice).toBe(60);
  });

  it('campanha Smart e cupom ficam fora da rotina', () => {
    const plan = planItem(
      { itemId: 'X', availableQuantity: 5, currentSellingPrice: 50, buyBoxStatus: 'competing', priceToWin: 45 },
      [campaign({ promotionType: 'SMART' }), campaign({ promotionType: 'SELLER_COUPON_CAMPAIGN' })],
      marginFn(10, 5),
      5,
    );
    expect(plan.campaigns.map((c) => c.action)).toEqual(['SKIP_NOT_ELIGIBLE', 'SKIP_NOT_ELIGIBLE']);
  });

  it('já participa a preço maior e a buy box é alcançável com margem: sugere baixar (não entra de novo)', () => {
    const plan = planItem(
      { itemId: 'X', availableQuantity: 5, currentSellingPrice: 50, buyBoxStatus: 'competing', priceToWin: 45 },
      [campaign({ status: 'started', currentDealPrice: 50 })],
      marginFn(10, 5),
      5,
    );
    expect(plan.campaigns[0].action).toBe('LOWER_SUGGESTED');
    expect(plan.campaigns[0].plannedPrice).toBe(45);
  });

  it('já participa e nada melhor: ALREADY_IN', () => {
    const plan = planItem(
      { itemId: 'X', availableQuantity: 5, currentSellingPrice: 50, buyBoxStatus: 'winning', priceToWin: null },
      [campaign({ status: 'started', currentDealPrice: 50 })],
      marginFn(10, 5),
      5,
    );
    expect(plan.campaigns[0].action).toBe('ALREADY_IN');
  });

  it('price_to_win com fração de centavo é arredondado para baixo', () => {
    expect(
      buyBoxTargetPrice({ itemId: 'X', availableQuantity: 1, currentSellingPrice: 50, buyBoxStatus: 'competing', priceToWin: 47.589 }),
    ).toBe(47.58);
  });

  it('rejeita preço atual inválido e margem mínima negativa', () => {
    const item = { itemId: 'X', availableQuantity: 1, currentSellingPrice: 0, buyBoxStatus: 'competing' as const, priceToWin: 1 };
    expect(() => planItem(item, [], marginFn(1, 1), 5)).toThrow(InvalidPlanInputError);
    expect(() => planItem({ ...item, currentSellingPrice: 10 }, [], marginFn(1, 1), -1)).toThrow(InvalidPlanInputError);
  });
});

describe('candidatePrices', () => {
  it('lista os preços distintos que precisarão de tarifa/frete, só de campanhas elegíveis', () => {
    const prices = candidatePrices(
      { itemId: 'X', availableQuantity: 1, currentSellingPrice: 55.9, buyBoxStatus: 'competing', priceToWin: 52.4 },
      [campaign({ allowedPriceA: 66.4 }), campaign({ promotionType: 'DEAL' }), campaign({ promotionType: 'SMART' })],
    );
    expect(prices).toEqual([52.4, 55.9]);
  });
});
