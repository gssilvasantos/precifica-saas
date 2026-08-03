import { Test } from '@nestjs/testing';
import { PricingDecisionService } from './pricing-decision.service';
import { PRICING_STRATEGIST, PricingDecision, PricingStrategist } from '../domain/pricing-strategist';
import {
  PRODUCT_CATALOG_READER,
  COMPETITOR_SNAPSHOT_READER,
  CHANNEL_LISTING_READER,
  PRICE_UPDATE_DISPATCHER,
  FINANCIAL_POLICY_READER,
  FEE_RULE_RESOLVER,
  LOGISTICS_COST_READER,
  CHANNEL_CATEGORY_RESOLVER,
  SHIPPING_POLICY_RESOLVER,
  CHANNEL_SELLER_PROFILE_READER,
} from '../../../shared/contracts/tokens';
import { ShippingPolicyResolver } from '../../../shared/contracts/shipping-policy-resolver.port';
import { ChannelSellerProfileReader } from '../../../shared/contracts/channel-seller-profile-reader.port';
import { FeeRuleResolver, ResolvedFeeRule } from '../../../shared/contracts/fee-rule-resolver.port';
import { LogisticsCostReader } from '../../../shared/contracts/logistics-cost-reader.port';
import { ChannelCategoryResolver } from '../../../shared/contracts/channel-category-resolver.port';
import { ProductCatalogReader, ProductCatalogSummary } from '../../../shared/contracts/product-catalog-reader.port';
import {
  CompetitiveOpportunitySummary,
  CompetitorSnapshotReader,
} from '../../../shared/contracts/competitor-snapshot-reader.port';
import { ChannelListingReader, ChannelListingSummary } from '../../../shared/contracts/channel-listing-reader.port';
import { PriceUpdateDispatcher, PriceUpdateOutcome } from '../../../shared/contracts/price-update-dispatcher.port';
import { FinancialPolicy, FinancialPolicyReader } from '../../../shared/contracts/financial-policy-reader.port';

// Teste de INTEGRAÇÃO (DI real do Nest entre PricingDecisionService e suas
// 4 portas) — mesma filosofia do price-update-dispatcher.integration.spec.ts:
// aqui é onde autoRepricingEnabled realmente decide se um preço é aplicado
// de verdade, então vale o mesmo rigor de "garantia de qualidade".
describe('PricingDecisionService (modo operação)', () => {
  const product: ProductCatalogSummary = {
    productId: 'prod-1',
    skuCode: 'SKU-001',
    name: 'Produto Teste',
    costPrice: 60,
    productCostPrice: 60,
    packagingCostPrice: null,
    desiredMarginPct: 30,
    minimumMarginPct: 20,
    autoRepricingEnabled: false,
    packagingId: null,
    isKit: false,
    mapPrice: null,
    ncm: null,
    fiscalOriginCode: null,
    cest: null,
    categoryId: null,
    photoUrls: [],
    weightKg: 1,
  };

  const opportunity: CompetitiveOpportunitySummary = {
    skuCode: 'SKU-001',
    bestCompetitorPrice: 90,
    bestCompetitorLabel: 'Concorrente X',
    ourPrice: 100,
    channelCode: 'NUVEMSHOP',
    priceGapPct: 0.1,
    buyBoxStatus: 'LOSING',
    rank: 2,
    detectedAt: new Date(),
  };

  const decision: PricingDecision = {
    skuCode: 'SKU-001',
    action: 'MATCH_COMPETITOR',
    recommendedPrice: 90,
    currentPrice: 100,
    resultingMarginPct: 33.3,
    safetyFloorPrice: 75,
    financialFloorPrice: 60,
    hitSafetyFloor: false,
    hitFinancialFloor: false,
    costs: {
      channelCode: 'NUVEMSHOP',
      commissionPct: 0.05,
      fixedFeeAmount: 0,
      logisticsCost: 0,
      taxRate: 0,
      sellerFreightCost: 0,
      freeShippingRequired: false,
      feeRuleId: 'rule-1',
      feeRuleVersion: 1,
      freeShippingThreshold: null,
      legacyFloorPriceForComparison: 75,
    },
    mapPrice: null,
    hitMapFloor: false,
    reason: 'teste',
  };

  // Comissão IMPORTADA do marketplace (01/08/2026) — o service passou a
  // exigir uma regra validada antes de decidir qualquer preço; sem este
  // mock, todo cenário abaixo seria (corretamente) bloqueado.
  const feeRule: ResolvedFeeRule = {
    tiers: [{ minPrice: 0, maxPrice: null, commissionPct: 0.05, fixedFeeAmount: 0 }],
    commissionBase: 'ITEM_PRICE',
    commissionCapAmount: null,
    ruleId: 'rule-1',
    ruleVersion: 1,
  };

  const listing: ChannelListingSummary = {
    channelCode: 'NUVEMSHOP',
    externalId: 'ext-123',
    currentPrice: 100,
    url: null,
  };

  // Default: sem governança financeira configurada (0/0) — não deve alterar
  // nenhum dos cenários já cobertos antes desta política existir.
  const noFinancialPolicy: FinancialPolicy = { taxRate: 0, minProfitMargin: 0, targetRoas: 3 };

  let strategist: jest.Mocked<PricingStrategist>;
  let catalog: jest.Mocked<ProductCatalogReader>;
  let competitorSnapshots: jest.Mocked<CompetitorSnapshotReader>;
  let channelListings: jest.Mocked<ChannelListingReader>;
  let dispatcher: jest.Mocked<PriceUpdateDispatcher>;
  let financialPolicy: jest.Mocked<FinancialPolicyReader>;
  let feeRules: jest.Mocked<FeeRuleResolver>;
  let logistics: jest.Mocked<LogisticsCostReader>;
  let channelCategories: jest.Mocked<ChannelCategoryResolver>;
  let shippingPolicies: jest.Mocked<ShippingPolicyResolver>;
  let sellerProfiles: jest.Mocked<ChannelSellerProfileReader>;
  let service: PricingDecisionService;

  async function buildService(): Promise<PricingDecisionService> {
    strategist = { calculateOptimalPrice: jest.fn().mockReturnValue(decision) };
    catalog = { findBySku: jest.fn().mockResolvedValue(product) };
    competitorSnapshots = { findOpportunity: jest.fn().mockResolvedValue(opportunity) };
    channelListings = {
      findBySku: jest.fn().mockResolvedValue(listing),
      findSkusByExternalIds: jest.fn().mockResolvedValue([]),
    };
    dispatcher = {
      dispatch: jest.fn().mockResolvedValue({ success: true, externalId: 'ext-123', appliedPrice: 90 } as PriceUpdateOutcome),
    };
    financialPolicy = { getPolicy: jest.fn().mockResolvedValue(noFinancialPolicy) };
    feeRules = { resolveFeeRule: jest.fn().mockResolvedValue(feeRule) };
    logistics = {
      getTotalLogisticsCost: jest.fn().mockResolvedValue(0),
      getEstimatedFreightCost: jest.fn().mockResolvedValue(0),
      getPackagingCostForOrder: jest.fn().mockResolvedValue(0),
    };
    channelCategories = { resolveExternalCategoryId: jest.fn().mockResolvedValue(null) };
    // Sem política de frete cadastrada: o motor se comporta exatamente como
    // antes desta feature (frete zero no piso), nunca inventando custo.
    shippingPolicies = { resolveShippingPolicy: jest.fn().mockResolvedValue(null) };
    // Perfil neutro por padrão: nada contratado, nenhum desconto — o lado
    // conservador, igual ao que o service assume quando o vendedor não
    // configurou o canal.
    sellerProfiles = {
      getProfile: jest.fn().mockResolvedValue({
        channelCode: 'NUVEMSHOP',
        professionalPlanActive: false,
        freightDiscountPct: 0,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PricingDecisionService,
        { provide: PRICING_STRATEGIST, useValue: strategist },
        { provide: PRODUCT_CATALOG_READER, useValue: catalog },
        { provide: COMPETITOR_SNAPSHOT_READER, useValue: competitorSnapshots },
        { provide: CHANNEL_LISTING_READER, useValue: channelListings },
        { provide: PRICE_UPDATE_DISPATCHER, useValue: dispatcher },
        { provide: FINANCIAL_POLICY_READER, useValue: financialPolicy },
        { provide: FEE_RULE_RESOLVER, useValue: feeRules },
        { provide: LOGISTICS_COST_READER, useValue: logistics },
        { provide: CHANNEL_CATEGORY_RESOLVER, useValue: channelCategories },
        { provide: SHIPPING_POLICY_RESOLVER, useValue: shippingPolicies },
        { provide: CHANNEL_SELLER_PROFILE_READER, useValue: sellerProfiles },
      ],
    }).compile();

    return moduleRef.get(PricingDecisionService);
  }

  beforeEach(async () => {
    service = await buildService();
  });

  it('decide(): calcula e devolve a decisão sem nunca chamar o dispatcher', async () => {
    const result = await service.decide('tenant-1', 'SKU-001');
    expect(result).toEqual(decision);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('decideAndMaybeApply(): autoRepricingEnabled=false — calcula mas NÃO aplica', async () => {
    catalog.findBySku.mockResolvedValue({ ...product, autoRepricingEnabled: false });

    const result = await service.decideAndMaybeApply('tenant-1', 'SKU-001');

    expect(result?.applied).toBe(false);
    expect(result?.reason).toMatch(/Automação desativada/);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('decideAndMaybeApply(): autoRepricingEnabled=true — calcula E aplica via PRICE_UPDATE_DISPATCHER', async () => {
    catalog.findBySku.mockResolvedValue({ ...product, autoRepricingEnabled: true });

    const result = await service.decideAndMaybeApply('tenant-1', 'SKU-001');

    expect(channelListings.findBySku).toHaveBeenCalledWith('tenant-1', 'NUVEMSHOP', 'SKU-001');
    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      marketplaceCode: 'NUVEMSHOP',
      skuCode: 'SKU-001',
      externalId: 'ext-123',
      newPrice: 90,
    });
    expect(result?.applied).toBe(true);
  });

  it('applyDecision(): SEMPRE aplica, mesmo com autoRepricingEnabled=false (caminho manual)', async () => {
    catalog.findBySku.mockResolvedValue({ ...product, autoRepricingEnabled: false });

    const result = await service.applyDecision('tenant-1', 'SKU-001');

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(result?.applied).toBe(true);
  });

  it('applyDecision(): preço recomendado igual ao atual — não aplica, não chama o dispatcher', async () => {
    strategist.calculateOptimalPrice.mockReturnValue({ ...decision, recommendedPrice: 100 }); // igual a currentPrice

    const result = await service.applyDecision('tenant-1', 'SKU-001');

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(result?.applied).toBe(false);
    expect(result?.reason).toMatch(/nada para aplicar/i);
  });

  // MUDANÇA DE COMPORTAMENTO (01/08/2026): antes, sem canal, o motor ainda
  // CALCULAVA uma decisão e só deixava de aplicá-la. Isso deixou de fazer
  // sentido quando o piso passou a depender da comissão do canal: sem saber
  // o canal, não há comissão, e sem comissão não existe piso confiável para
  // calcular. Agora bloqueia antes, devolvendo null — a resposta honesta é
  // "não sei", não um número que parece uma recomendação.
  it('applyDecision(): sem channelCode na oportunidade — não decide nada, não chama o dispatcher', async () => {
    competitorSnapshots.findOpportunity.mockResolvedValue({ ...opportunity, channelCode: null });

    const result = await service.applyDecision('tenant-1', 'SKU-001');

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(result).toBeNull();
    expect(strategist.calculateOptimalPrice).not.toHaveBeenCalled();
  });

  it('applyDecision(): sem anúncio encontrado no canal — não aplica, não chama o dispatcher', async () => {
    channelListings.findBySku.mockResolvedValue(null);

    const result = await service.applyDecision('tenant-1', 'SKU-001');

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(result?.applied).toBe(false);
    expect(result?.reason).toMatch(/Nenhum anúncio encontrado/);
  });

  it('decide()/applyDecision(): produto não encontrado — retorna null, sem exceção', async () => {
    catalog.findBySku.mockResolvedValue(null);

    await expect(service.decide('tenant-1', 'SKU-404')).resolves.toBeNull();
    await expect(service.applyDecision('tenant-1', 'SKU-404')).resolves.toBeNull();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  describe('piso financeiro (defesa em profundidade)', () => {
    // costPrice 60, comissão 5% (regra importada do canal, ver `feeRule`),
    // taxRate 6% + minProfitMargin 30%
    // => financialFloorPrice = 60 / (1 - 0.05 - 0.06 - 0.30) = 60 / 0.59 = 101.69,
    // maior que os 90 que o strategist (mockado) recomendou — deve vencer.
    //
    // Antes de 01/08/2026 este número era 93.75, porque a comissão do canal
    // ficava de fora da conta — os 7,94 de diferença são exatamente a
    // comissão que o vendedor pagava sem que o piso soubesse.
    beforeEach(() => {
      financialPolicy.getPolicy.mockResolvedValue({ taxRate: 0.06, minProfitMargin: 0.3, targetRoas: 3 });
    });

    it('decide(): sobrescreve a sugestão do strategist quando ela fura o piso financeiro', async () => {
      const result = await service.decide('tenant-1', 'SKU-001');

      expect(result?.action).toBe('FINANCIAL_FLOOR_APPLIED');
      expect(result?.recommendedPrice).toBeCloseTo(101.69, 2);
      expect(result?.hitFinancialFloor).toBe(true);
      expect(result?.reason).toMatch(/piso financeiro por proteção de margem/i);
    });

    it('applyDecision(): aplica o preço JÁ AJUSTADO pelo piso financeiro, não a sugestão original', async () => {
      const result = await service.applyDecision('tenant-1', 'SKU-001');

      const dispatchedCommand = dispatcher.dispatch.mock.calls[0][0];
      expect(dispatchedCommand.newPrice).toBeCloseTo(101.69, 2);
      expect(result?.decision.action).toBe('FINANCIAL_FLOOR_APPLIED');
    });

    it('busca a política financeira do tenant certo', async () => {
      await service.decide('tenant-42', 'SKU-001');
      expect(financialPolicy.getPolicy).toHaveBeenCalledWith('tenant-42');
    });
  });

  describe('piso de MAP (defesa em profundidade)', () => {
    // strategist mockado devolve `decision` (recommendedPrice 90) sem saber
    // nada de MAP — simula um PricingStrategist customizado/futuro que NÃO
    // implemente o piso de MAP corretamente. O recheck em resolveDecision
    // deve corrigir de qualquer forma, usando product.mapPrice diretamente
    // (não um campo devolvido pelo strategist).
    it('decide(): sobrescreve a sugestão do strategist quando ela fura o MAP do produto', async () => {
      catalog.findBySku.mockResolvedValue({ ...product, mapPrice: 95 });

      const result = await service.decide('tenant-1', 'SKU-001');

      expect(result?.action).toBe('MAP_FLOOR_APPLIED');
      expect(result?.recommendedPrice).toBe(95);
      expect(result?.hitMapFloor).toBe(true);
      expect(result?.mapPrice).toBe(95);
      expect(result?.reason).toMatch(/MAP/);
    });

    it('applyDecision(): aplica o preço JÁ AJUSTADO pelo MAP, não a sugestão original do strategist', async () => {
      catalog.findBySku.mockResolvedValue({ ...product, mapPrice: 95, autoRepricingEnabled: false });

      const result = await service.applyDecision('tenant-1', 'SKU-001');

      const dispatchedCommand = dispatcher.dispatch.mock.calls[0][0];
      expect(dispatchedCommand.newPrice).toBe(95);
      expect(result?.decision.action).toBe('MAP_FLOOR_APPLIED');
    });

    it('mapPrice null no produto: recheck não altera a decisão do strategist', async () => {
      catalog.findBySku.mockResolvedValue({ ...product, mapPrice: null });

      const result = await service.decide('tenant-1', 'SKU-001');

      expect(result?.action).toBe('MATCH_COMPETITOR');
      expect(result?.hitMapFloor).toBe(false);
    });

    // Gate FINAL (última linha de defesa, imediatamente antes do dispatch) —
    // em condições normais NUNCA dispara, porque o recheck acima já corrige
    // qualquer decisão antes de chegar aqui. Para provar que o gate por si
    // só bloqueia o dispatcher, chamamos dispatchDecision diretamente
    // (contornando resolveDecision) com uma decisão que "escapou" das duas
    // camadas anteriores — exatamente o cenário de bug futuro que este gate
    // existe para pegar.
    it('dispatchDecision(): gate final bloqueia o dispatcher mesmo se uma decisão inválida escapar das camadas anteriores', async () => {
      const decisionThatSlippedThrough: PricingDecision = {
        ...decision,
        recommendedPrice: 80, // abaixo do mapPrice abaixo
      };

      const result = await (service as any).dispatchDecision('tenant-1', decisionThatSlippedThrough, 'NUVEMSHOP', 95);

      expect(dispatcher.dispatch).not.toHaveBeenCalled();
      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/abaixo do MAP/);
    });

    it('dispatchDecision(): não bloqueia quando o preço respeita o MAP', async () => {
      channelListings.findBySku.mockResolvedValue(listing);

      const result = await (service as any).dispatchDecision('tenant-1', decision, 'NUVEMSHOP', 80);

      expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
      expect(result.applied).toBe(true);
    });
  });

  // Bloco novo (01/08/2026) — princípio de produto definido pelo usuário: o
  // único custo digitado no sistema é o do produto (mais imposto e
  // embalagem); TODA taxa de marketplace é importada do próprio canal. A
  // consequência de projeto é esta: sem taxa importada, não se precifica.
  describe('taxa do marketplace é sempre importada, nunca presumida', () => {
    beforeEach(async () => {
      service = await buildService();
    });

    it('bloqueia a decisão quando não há regra de comissão validada para o canal', async () => {
      feeRules.resolveFeeRule.mockResolvedValue(null);

      const result = await service.decide('tenant-1', 'SKU-001');

      expect(result).toBeNull();
      // O ponto central: não chegou nem a calcular. Assumir comissão zero
      // aqui seria reintroduzir silenciosamente o bug de margem bruta.
      expect(strategist.calculateOptimalPrice).not.toHaveBeenCalled();
    });

    it('nunca aplica preço no marketplace quando a taxa é desconhecida', async () => {
      feeRules.resolveFeeRule.mockResolvedValue(null);

      const result = await service.applyDecision('tenant-1', 'SKU-001');

      expect(result).toBeNull();
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('usa a categoria do canal para achar a taxa específica daquele nicho', async () => {
      channelCategories.resolveExternalCategoryId.mockResolvedValue('MLB1234');
      catalog.findBySku.mockResolvedValue({ ...product, categoryId: 'cat-interna-1' });

      await service.decide('tenant-1', 'SKU-001');

      expect(feeRules.resolveFeeRule).toHaveBeenCalledWith(
        expect.objectContaining({ categoryCode: 'MLB1234', marketplaceCode: 'NUVEMSHOP' }),
      );
    });

    it('cai para o escopo GLOBAL quando o produto não tem categoria mapeada no canal', async () => {
      channelCategories.resolveExternalCategoryId.mockResolvedValue(null);

      await service.decide('tenant-1', 'SKU-001');

      expect(feeRules.resolveFeeRule).toHaveBeenCalledWith(
        expect.objectContaining({ categoryCode: 'GLOBAL' }),
      );
    });

    // Cenário Amazon (01/08/2026): a mesma tabela de taxas do canal produz
    // custo por item diferente conforme o vendedor assine ou não o "Plano
    // de vendas profissional" (R$19/mês). Assinando, os R$2/item somem.
    it('Plano de vendas profissional ATIVO: a tarifa de R$2/item não entra no cálculo', async () => {
      feeRules.resolveFeeRule.mockResolvedValue({
        tiers: [
          { minPrice: 0, maxPrice: null, commissionPct: 0.12, fixedFeeAmount: 0, planWaivablePerItemFee: 2 },
        ],
        commissionBase: 'ITEM_PRICE',
        commissionCapAmount: null,
        ruleId: 'rule-amazon',
        ruleVersion: 1,
      });
      sellerProfiles.getProfile.mockResolvedValue({
        channelCode: 'AMAZON',
        professionalPlanActive: true,
        freightDiscountPct: 0,
      });

      await service.decide('tenant-1', 'SKU-001');

      const context = strategist.calculateOptimalPrice.mock.calls[0][0];
      expect(context.feeTiers[0].fixedFeeAmount).toBe(0);
    });

    it('Plano de vendas profissional INATIVO: os R$2/item entram no cálculo', async () => {
      feeRules.resolveFeeRule.mockResolvedValue({
        tiers: [
          { minPrice: 0, maxPrice: null, commissionPct: 0.12, fixedFeeAmount: 0, planWaivablePerItemFee: 2 },
        ],
        commissionBase: 'ITEM_PRICE',
        commissionCapAmount: null,
        ruleId: 'rule-amazon',
        ruleVersion: 1,
      });
      sellerProfiles.getProfile.mockResolvedValue({
        channelCode: 'AMAZON',
        professionalPlanActive: false,
        freightDiscountPct: 0,
      });

      await service.decide('tenant-1', 'SKU-001');

      const context = strategist.calculateOptimalPrice.mock.calls[0][0];
      expect(context.feeTiers[0].fixedFeeAmount).toBe(2);
    });

    it('sem perfil configurado, assume o lado conservador (paga a tarifa por item)', async () => {
      // getProfile nunca devolve null — o service recebe o perfil NEUTRO.
      // Assumir o plano por omissão calcularia preço a menor e viraria
      // prejuízo silencioso.
      feeRules.resolveFeeRule.mockResolvedValue({
        tiers: [
          { minPrice: 0, maxPrice: null, commissionPct: 0.12, fixedFeeAmount: 0, planWaivablePerItemFee: 2 },
        ],
        commissionBase: 'ITEM_PRICE',
        commissionCapAmount: null,
        ruleId: 'rule-amazon',
        ruleVersion: 1,
      });

      await service.decide('tenant-1', 'SKU-001');

      const context = strategist.calculateOptimalPrice.mock.calls[0][0];
      expect(context.feeTiers[0].fixedFeeAmount).toBe(2);
    });

    it('política de frete: o vendedor só paga frete acima do limiar do canal', async () => {
      // Política do Mercado Livre: até R$79 o canal cobre 100%; a partir
      // daí o frete grátis é obrigatório e o vendedor arca.
      shippingPolicies.resolveShippingPolicy.mockResolvedValue({
        bands: [
          { minPrice: 0, maxPrice: 79, freeShippingRequired: false, channelSubsidyPct: 1, channelSubsidyCapAmount: null },
          { minPrice: 79, maxPrice: null, freeShippingRequired: true, channelSubsidyPct: 0, channelSubsidyCapAmount: null },
        ],
        ruleId: 'ship-ml',
        ruleVersion: 1,
      });
      logistics.getEstimatedFreightCost.mockResolvedValue(20);

      await service.decide('tenant-1', 'SKU-001');

      const context = strategist.calculateOptimalPrice.mock.calls[0][0];
      const below = context.feeTiers.find((t) => t.minPrice === 0);
      const above = context.feeTiers.find((t) => t.minPrice === 79);

      expect(below?.sellerFreightCost).toBe(0); // canal cobre
      expect(above?.sellerFreightCost).toBe(20); // vendedor arca
      expect(context.freeShippingThreshold).toBe(79);
    });

    it('desconto de frete por reputação reduz o que o vendedor paga', async () => {
      shippingPolicies.resolveShippingPolicy.mockResolvedValue({
        bands: [
          { minPrice: 0, maxPrice: null, freeShippingRequired: true, channelSubsidyPct: 0, channelSubsidyCapAmount: null },
        ],
        ruleId: 'ship-ml',
        ruleVersion: 1,
      });
      logistics.getEstimatedFreightCost.mockResolvedValue(20);
      sellerProfiles.getProfile.mockResolvedValue({
        channelCode: 'MERCADO_LIVRE',
        professionalPlanActive: false,
        freightDiscountPct: 0.7, // reputação verde-escuro
      });

      await service.decide('tenant-1', 'SKU-001');

      const context = strategist.calculateOptimalPrice.mock.calls[0][0];
      expect(context.feeTiers[0].sellerFreightCost).toBeCloseTo(6, 2); // 20 * (1 - 0.7)
    });

    it('monta o contexto com o custo SEM embalagem, para não contar embalagem duas vezes', async () => {
      // costPrice (efetivo) = 75, productCostPrice = 60, embalagem = 15.
      // A embalagem já vem dentro de logisticsCost — usar 75 aqui somaria
      // os 15 duas vezes.
      catalog.findBySku.mockResolvedValue({
        ...product,
        costPrice: 75,
        productCostPrice: 60,
        packagingCostPrice: 15,
      });
      logistics.getTotalLogisticsCost.mockResolvedValue(15);

      await service.decide('tenant-1', 'SKU-001');

      expect(strategist.calculateOptimalPrice).toHaveBeenCalledWith(
        expect.objectContaining({ costPrice: 60, logisticsCost: 15, effectiveCostPriceLegacy: 75 }),
      );
    });
  });
});
