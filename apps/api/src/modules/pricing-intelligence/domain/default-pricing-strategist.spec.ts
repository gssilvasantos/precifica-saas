import { DefaultPricingStrategist } from './default-pricing-strategist';
import { InvalidPricingContextError, PricingContext } from './pricing-strategist';

// Testa a invariante mais importante do pedido ("regra de ouro"): o
// PricingStrategist NUNCA pode sugerir um preço que fure a margem mínima —
// nem quando reagindo à concorrência, nem quando o preço atual já está
// (por algum motivo externo) abaixo do piso. Domínio puro, sem
// Test.createTestingModule — não há DI nem Prisma envolvidos aqui.
describe('DefaultPricingStrategist', () => {
  const strategist = new DefaultPricingStrategist();

  // costPrice 60, minimumMarginPct 20% => safetyFloorPrice = 60 / (1 - 0.2) = 75
  // taxRate/minProfitMargin 0 => financialFloorPrice = 60 (sempre <= safetyFloorPrice
  // nestes testes, então o piso por produto continua sendo o decisivo — mesmo
  // comportamento de antes da governança financeira existir).
  const baseContext: PricingContext = {
    skuCode: 'SKU-001',
    costPrice: 60,
    currentPrice: 100,
    desiredMarginPct: 30,
    minimumMarginPct: 20,
    taxRate: 0,
    minProfitMargin: 0,
    competitorBestPrice: null,
    buyBoxStatus: 'UNKNOWN',
    mapPrice: null,
  };

  it('LOSING com concorrente acima do piso: iguala o concorrente', () => {
    const decision = strategist.calculateOptimalPrice({
      ...baseContext,
      buyBoxStatus: 'LOSING',
      competitorBestPrice: 90,
    });

    expect(decision.action).toBe('MATCH_COMPETITOR');
    expect(decision.recommendedPrice).toBe(90);
    expect(decision.hitSafetyFloor).toBe(false);
    expect(decision.resultingMarginPct).toBeCloseTo(33.33, 1);
  });

  it('LOSING com concorrente ABAIXO do piso: aplica o preço de segurança, nunca o preço do concorrente', () => {
    const decision = strategist.calculateOptimalPrice({
      ...baseContext,
      buyBoxStatus: 'LOSING',
      competitorBestPrice: 65, // abaixo dos 75 de piso
    });

    expect(decision.action).toBe('SAFETY_FLOOR_APPLIED');
    expect(decision.recommendedPrice).toBe(75);
    expect(decision.hitSafetyFloor).toBe(true);
    expect(decision.resultingMarginPct).toBeCloseTo(20, 5);
    expect(decision.recommendedPrice).not.toBe(65);
  });

  it('WINNING: mantém o preço atual', () => {
    const decision = strategist.calculateOptimalPrice({
      ...baseContext,
      buyBoxStatus: 'WINNING',
      competitorBestPrice: 110,
      currentPrice: 100,
    });

    expect(decision.action).toBe('HOLD_PRICE');
    expect(decision.recommendedPrice).toBe(100);
    expect(decision.hitSafetyFloor).toBe(false);
  });

  it('UNKNOWN (sem dado de concorrência): mantém o preço atual', () => {
    const decision = strategist.calculateOptimalPrice(baseContext);

    expect(decision.action).toBe('HOLD_PRICE');
    expect(decision.recommendedPrice).toBe(100);
  });

  it('proteção incondicional: mesmo WINNING, se o preço atual já está abaixo do piso, aplica o piso', () => {
    const decision = strategist.calculateOptimalPrice({
      ...baseContext,
      buyBoxStatus: 'WINNING',
      currentPrice: 70, // abaixo dos 75 de piso — dado inconsistente (edição manual, por exemplo)
    });

    expect(decision.action).toBe('SAFETY_FLOOR_APPLIED');
    expect(decision.recommendedPrice).toBe(75);
    expect(decision.hitSafetyFloor).toBe(true);
  });

  it('rejeita contexto inválido (minimumMarginPct fora de [0, 100))', () => {
    expect(() =>
      strategist.calculateOptimalPrice({ ...baseContext, minimumMarginPct: 100 }),
    ).toThrow(InvalidPricingContextError);
  });

  it('rejeita contexto inválido (costPrice <= 0)', () => {
    expect(() => strategist.calculateOptimalPrice({ ...baseContext, costPrice: 0 })).toThrow(
      InvalidPricingContextError,
    );
  });

  it('rejeita contexto inválido (taxRate + minProfitMargin >= 1)', () => {
    expect(() =>
      strategist.calculateOptimalPrice({ ...baseContext, taxRate: 0.6, minProfitMargin: 0.5 }),
    ).toThrow(InvalidPricingContextError);
  });

  describe('piso financeiro (governança do tenant)', () => {
    // minimumMarginPct 10% => safetyFloorPrice = 60 / 0.9 = 66.67
    // taxRate 6% + minProfitMargin 8% => financialFloorPrice = 60 / 0.86 = 69.77
    // financialFloorPrice > safetyFloorPrice nesse cenário — o piso financeiro deve vencer.
    const contextWithFinancialFloor: PricingContext = {
      ...baseContext,
      minimumMarginPct: 10,
      taxRate: 0.06,
      minProfitMargin: 0.08,
    };

    it('quando o piso financeiro é mais restritivo que o piso do produto, ele vence', () => {
      const decision = strategist.calculateOptimalPrice({
        ...contextWithFinancialFloor,
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 65, // abaixo dos dois pisos
      });

      expect(decision.action).toBe('FINANCIAL_FLOOR_APPLIED');
      expect(decision.recommendedPrice).toBeCloseTo(69.77, 2);
      expect(decision.hitFinancialFloor).toBe(true);
      expect(decision.hitSafetyFloor).toBe(false);
      expect(decision.reason).toMatch(/piso financeiro por proteção de margem/i);
    });

    it('quando o piso do produto é mais restritivo que o financeiro, ele continua vencendo (SAFETY_FLOOR_APPLIED)', () => {
      const decision = strategist.calculateOptimalPrice({
        ...contextWithFinancialFloor,
        minimumMarginPct: 40, // safetyFloorPrice = 60/0.6 = 100, bem acima do financeiro (69.77)
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 65,
      });

      expect(decision.action).toBe('SAFETY_FLOOR_APPLIED');
      expect(decision.recommendedPrice).toBe(100);
      expect(decision.hitSafetyFloor).toBe(true);
      expect(decision.hitFinancialFloor).toBe(false);
    });

    it('sempre calcula os dois pisos no retorno, mesmo quando nenhum deles é o vigente', () => {
      const decision = strategist.calculateOptimalPrice({
        ...contextWithFinancialFloor,
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 90, // acima dos dois pisos
      });

      expect(decision.action).toBe('MATCH_COMPETITOR');
      expect(decision.safetyFloorPrice).toBeCloseTo(66.67, 2);
      expect(decision.financialFloorPrice).toBeCloseTo(69.77, 2);
      expect(decision.hitSafetyFloor).toBe(false);
      expect(decision.hitFinancialFloor).toBe(false);
    });
  });

  describe('piso de MAP (política de preço mínimo do fornecedor)', () => {
    // safetyFloorPrice = 75, financialFloorPrice = 60 (taxRate/minProfitMargin
    // zerados neste bloco) — mapPrice 95 é o mais restritivo dos três.
    it('quando o MAP é mais restritivo que os outros dois pisos, ele vence', () => {
      const decision = strategist.calculateOptimalPrice({
        ...baseContext,
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 80, // acima do safetyFloor (75), mas abaixo do MAP (95)
        mapPrice: 95,
      });

      expect(decision.action).toBe('MAP_FLOOR_APPLIED');
      expect(decision.recommendedPrice).toBe(95);
      expect(decision.hitMapFloor).toBe(true);
      expect(decision.hitSafetyFloor).toBe(false);
      expect(decision.hitFinancialFloor).toBe(false);
      expect(decision.mapPrice).toBe(95);
      expect(decision.reason).toMatch(/Preço Mínimo Anunciado \(MAP\)/);
    });

    it('quando o MAP é mais frouxo que os outros pisos, não é acionado', () => {
      const decision = strategist.calculateOptimalPrice({
        ...baseContext,
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 65, // abaixo do safetyFloor (75) — safety floor deve vencer
        mapPrice: 50, // mais frouxo que o safetyFloor
      });

      expect(decision.action).toBe('SAFETY_FLOOR_APPLIED');
      expect(decision.recommendedPrice).toBe(75);
      expect(decision.hitMapFloor).toBe(false);
      expect(decision.mapPrice).toBe(50); // ecoado mesmo sem ser o vigente
    });

    it('quando o MAP empata com o piso financeiro mais restritivo, o MAP vence (contratual > margem interna)', () => {
      const decision = strategist.calculateOptimalPrice({
        ...baseContext,
        minimumMarginPct: 10, // safetyFloorPrice = 66.67, mais frouxo
        taxRate: 0.06,
        minProfitMargin: 0.08, // financialFloorPrice = 69.77
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 65,
        mapPrice: 69.77, // igual ao financialFloorPrice
      });

      expect(decision.action).toBe('MAP_FLOOR_APPLIED');
      expect(decision.hitMapFloor).toBe(true);
      expect(decision.hitFinancialFloor).toBe(false);
    });

    it('mapPrice null: não é acionado nem influencia o piso efetivo', () => {
      const decision = strategist.calculateOptimalPrice({
        ...baseContext,
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 80,
        mapPrice: null,
      });

      expect(decision.action).toBe('MATCH_COMPETITOR');
      expect(decision.recommendedPrice).toBe(80);
      expect(decision.hitMapFloor).toBe(false);
      expect(decision.mapPrice).toBeNull();
    });

    it('rejeita contexto inválido (mapPrice <= 0)', () => {
      expect(() =>
        strategist.calculateOptimalPrice({ ...baseContext, mapPrice: 0 }),
      ).toThrow(InvalidPricingContextError);
    });
  });
});
