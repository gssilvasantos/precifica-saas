import { DefaultPricingStrategist } from './default-pricing-strategist';
import {
  InvalidPricingContextError,
  PricingContext,
  UnreachableMarginError,
  netMarginPctOf,
} from './pricing-strategist';

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
  // Canal "neutro" (comissão, taxa fixa e logística zeradas): com os três
  // em zero, a fórmula nova de piso se reduz exatamente à antiga
  // (custo / (1 - margem)), o que mantém todos os casos históricos abaixo
  // válidos sem reescrever número nenhum — e ao mesmo tempo prova que a
  // correção de 01/08/2026 é uma GENERALIZAÇÃO da regra anterior, não uma
  // regra diferente. Os cenários com comissão real vivem no describe
  // 'custos do canal' no fim do arquivo.
  const baseContext: PricingContext = {
    skuCode: 'SKU-001',
    costPrice: 60,
    currentPrice: 100,
    desiredMarginPct: 30,
    minimumMarginPct: 20,
    taxRate: 0,
    minProfitMargin: 0,
    channelCode: 'CANAL_TESTE',
    feeTiers: [{ minPrice: 0, maxPrice: null, commissionPct: 0, fixedFeeAmount: 0, sellerFreightCost: 0 }],
    commissionCapAmount: null,
    freeShippingThreshold: null,
    logisticsCost: 0,
    feeRuleId: null,
    feeRuleVersion: null,
    effectiveCostPriceLegacy: 60,
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
    // MUDANÇA SEMÂNTICA (01/08/2026): os dois pisos agora usam a MESMA
    // fórmula de margem líquida, variando só o alvo — o do produto
    // (minimumMarginPct) e o global do tenant (minProfitMargin). Antes eles
    // eram incomparáveis: o do produto era margem BRUTA sobre o custo e o
    // financeiro já descontava imposto, então "qual é mais restritivo"
    // dependia de comparar duas coisas diferentes. Agora vence simplesmente
    // quem pede a maior margem líquida, o que é previsível e explicável ao
    // usuário.
    //
    // minimumMarginPct 5% => safetyFloorPrice   = 60 / (1 - 0.06 - 0.05) = 67.42
    // minProfitMargin  8% => financialFloorPrice = 60 / (1 - 0.06 - 0.08) = 69.77
    // financialFloorPrice > safetyFloorPrice — o piso financeiro deve vencer.
    const contextWithFinancialFloor: PricingContext = {
      ...baseContext,
      minimumMarginPct: 5,
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
        minimumMarginPct: 40, // safetyFloorPrice = 60/(1-0.06-0.40) = 111.11, acima do financeiro (69.77)
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 65,
      });

      expect(decision.action).toBe('SAFETY_FLOOR_APPLIED');
      expect(decision.recommendedPrice).toBeCloseTo(111.11, 2);
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
      expect(decision.safetyFloorPrice).toBeCloseTo(67.42, 2);
      expect(decision.financialFloorPrice).toBeCloseTo(69.77, 2);
      expect(decision.hitSafetyFloor).toBe(false);
      expect(decision.hitFinancialFloor).toBe(false);
    });
  });

  // Bloco novo (01/08/2026) — a razão de ser da correção descrita em
  // docs/revisao-geral-2026-08.md, §1. Antes desta mudança, o motor
  // calculava o piso só com custo e margem: no cenário abaixo ele devolvia
  // R$75 e classificava como "seguro", quando na prática a venda dava
  // prejuízo depois da comissão do Mercado Livre e do frete.
  describe('custos do canal entram no piso (regressão do bug de margem bruta)', () => {
    // Cenário exato do documento: custo 60, margem mínima 20%, Mercado
    // Livre com 14% de comissão e R$20 de custo logístico.
    const mercadoLivreContext: PricingContext = {
      ...baseContext,
      costPrice: 60,
      minimumMarginPct: 20,
      channelCode: 'MERCADO_LIVRE',
      feeTiers: [{ minPrice: 0, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 0, sellerFreightCost: 0 }],
      logisticsCost: 20,
      effectiveCostPriceLegacy: 60,
    };

    it('o piso cobre comissão e logística — não é mais o R$75 da fórmula antiga', () => {
      const decision = strategist.calculateOptimalPrice({
        ...mercadoLivreContext,
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 70,
      });

      // Piso correto: (60 + 20) / (1 - 0.14 - 0 - 0.20) = 80 / 0.66 = 121.21
      expect(decision.recommendedPrice).toBeCloseTo(121.21, 2);
      expect(decision.action).toBe('SAFETY_FLOOR_APPLIED');
      // A fórmula antiga daria 75 — mantido no breakdown só para a UI poder
      // mostrar o "antes x depois" durante a transição.
      expect(decision.costs.legacyFloorPriceForComparison).toBeCloseTo(75, 2);
    });

    it('no piso, a margem LÍQUIDA resultante é de fato a margem mínima configurada', () => {
      const decision = strategist.calculateOptimalPrice({
        ...mercadoLivreContext,
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 70,
      });

      // É esta asserção que fecha o buraco: no preço recomendado, o que
      // sobra depois de comissão + logística + custo é exatamente 20%.
      expect(decision.resultingMarginPct).toBeCloseTo(20, 1);
    });

    it('o preço que a fórmula ANTIGA considerava seguro (R$75) dá prejuízo real', () => {
      // Prova aritmética do bug, independente da implementação: a R$75, o
      // vendedor recebe 75 - 10.50 (comissão) - 20 (logística) = 44.50,
      // contra um custo de 60.
      const costs = { commissionPct: 0.14, fixedFeeAmount: 0, logisticsCost: 20, taxRate: 0, sellerFreightCost: 0 };
      expect(netMarginPctOf(75, 60, costs)).toBeLessThan(0);
    });

    it('recusa margem inalcançável em vez de devolver um preço inventado', () => {
      // comissão 30% + imposto 10% + margem mínima 65% = 105% do preço.
      expect(() =>
        strategist.calculateOptimalPrice({
          ...mercadoLivreContext,
          feeTiers: [{ minPrice: 0, maxPrice: null, commissionPct: 0.3, fixedFeeAmount: 0, sellerFreightCost: 0 }],
          taxRate: 0.1,
          minimumMarginPct: 65,
        }),
      ).toThrow(UnreachableMarginError);
    });

    it('a taxa fixa por venda também entra no piso', () => {
      const decision = strategist.calculateOptimalPrice({
        ...mercadoLivreContext,
        // taxa fixa de item barato do ML
        feeTiers: [{ minPrice: 0, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 6, sellerFreightCost: 0 }],
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 70,
      });

      // (60 + 20 + 6) / 0.66 = 130.30
      expect(decision.recommendedPrice).toBeCloseTo(130.3, 1);
    });
  });

  // Bloco novo (01/08/2026) — tabela de faixas e o problema circular
  // (docs/marketplace-fee-model-architecture.md, §6). Usa a tabela REAL da
  // Shopee 2026, que é o caso mais severo dos sete canais mapeados: a
  // comissão cai de 20% para 14% em R$80, mas a taxa fixa salta de R$4 para
  // R$16 no mesmo ponto.
  describe('tabela de faixas de preço (Shopee 2026)', () => {
    const shopeeTiers = [
      { minPrice: 0, maxPrice: 80, commissionPct: 0.2, fixedFeeAmount: 4, sellerFreightCost: 0 },
      { minPrice: 80, maxPrice: 100, commissionPct: 0.14, fixedFeeAmount: 16, sellerFreightCost: 0 },
      { minPrice: 100, maxPrice: 200, commissionPct: 0.14, fixedFeeAmount: 20, sellerFreightCost: 0 },
      { minPrice: 200, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 26, sellerFreightCost: 0 },
    ];

    const shopeeContext: PricingContext = {
      ...baseContext,
      channelCode: 'SHOPEE',
      feeTiers: shopeeTiers,
      costPrice: 50,
      minimumMarginPct: 10,
      logisticsCost: 0,
      effectiveCostPriceLegacy: 50,
    };

    it('escolhe a faixa que dá o MENOR piso quando mais de uma é consistente', () => {
      const decision = strategist.calculateOptimalPrice({
        ...shopeeContext,
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 40, // bem abaixo de qualquer piso
      });

      // Faixa <80 (20% + R$4):  (50+4)/(1-0.20-0.10) = 77.14 -> cai em <80 ✔
      // Faixa 80-100 (14%+R$16): (50+16)/(1-0.14-0.10) = 86.84 -> cai em 80-100 ✔
      // Duas soluções consistentes; vence a menor (77.14) — vender a 77.14
      // pagando 20% sobra mais que vender a 86.84 pagando 14% + R$16.
      expect(decision.recommendedPrice).toBeCloseTo(77.14, 2);
      expect(decision.costs.commissionPct).toBe(0.2);
      expect(decision.costs.fixedFeeAmount).toBe(4);
    });

    it('a margem líquida no piso bate com a margem mínima, com a taxa da faixa certa', () => {
      const decision = strategist.calculateOptimalPrice({
        ...shopeeContext,
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 40,
      });

      expect(decision.resultingMarginPct).toBeCloseTo(10, 1);
    });

    it('reporta a taxa da faixa em que o preço FINAL caiu, não a que gerou o piso', () => {
      // Concorrente a 150 está acima de todos os pisos: o preço final é 150,
      // que cai na terceira faixa (100-200, taxa fixa R$20) — mesmo que o
      // piso tenha sido calculado na primeira.
      const decision = strategist.calculateOptimalPrice({
        ...shopeeContext,
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 150,
      });

      expect(decision.recommendedPrice).toBe(150);
      expect(decision.costs.fixedFeeAmount).toBe(20);
    });

    it('produto caro cai na última faixa (sem teto) sem quebrar', () => {
      const decision = strategist.calculateOptimalPrice({
        ...shopeeContext,
        costPrice: 400,
        buyBoxStatus: 'LOSING',
        competitorBestPrice: 300,
      });

      // (400+26)/(1-0.14-0.10) = 560.53, dentro da faixa >=200 ✔
      expect(decision.recommendedPrice).toBeCloseTo(560.53, 2);
      expect(decision.costs.fixedFeeAmount).toBe(26);
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
        minimumMarginPct: 5, // safetyFloorPrice = 60/(1-0.06-0.05) = 67.42, mais frouxo
        taxRate: 0.06,
        minProfitMargin: 0.08, // financialFloorPrice = 60/(1-0.06-0.08) = 69.77
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
