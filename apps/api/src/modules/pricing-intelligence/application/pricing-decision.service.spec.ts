import { Test } from '@nestjs/testing';
import { PricingDecisionService } from './pricing-decision.service';
import { PRICING_STRATEGIST, PricingDecision, PricingStrategist } from '../domain/pricing-strategist';
import {
  PRODUCT_CATALOG_READER,
  COMPETITOR_SNAPSHOT_READER,
  CHANNEL_LISTING_READER,
  PRICE_UPDATE_DISPATCHER,
  FINANCIAL_POLICY_READER,
} from '../../../shared/contracts/tokens';
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
    reason: 'teste',
  };

  const listing: ChannelListingSummary = {
    channelCode: 'NUVEMSHOP',
    externalId: 'ext-123',
    currentPrice: 100,
    url: null,
  };

  // Default: sem governança financeira configurada (0/0) — não deve alterar
  // nenhum dos cenários já cobertos antes desta política existir.
  const noFinancialPolicy: FinancialPolicy = { taxRate: 0, minProfitMargin: 0 };

  let strategist: jest.Mocked<PricingStrategist>;
  let catalog: jest.Mocked<ProductCatalogReader>;
  let competitorSnapshots: jest.Mocked<CompetitorSnapshotReader>;
  let channelListings: jest.Mocked<ChannelListingReader>;
  let dispatcher: jest.Mocked<PriceUpdateDispatcher>;
  let financialPolicy: jest.Mocked<FinancialPolicyReader>;
  let service: PricingDecisionService;

  async function buildService(): Promise<PricingDecisionService> {
    strategist = { calculateOptimalPrice: jest.fn().mockReturnValue(decision) };
    catalog = { findBySku: jest.fn().mockResolvedValue(product) };
    competitorSnapshots = { findOpportunity: jest.fn().mockResolvedValue(opportunity) };
    channelListings = { findBySku: jest.fn().mockResolvedValue(listing) };
    dispatcher = {
      dispatch: jest.fn().mockResolvedValue({ success: true, externalId: 'ext-123', appliedPrice: 90 } as PriceUpdateOutcome),
    };
    financialPolicy = { getPolicy: jest.fn().mockResolvedValue(noFinancialPolicy) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PricingDecisionService,
        { provide: PRICING_STRATEGIST, useValue: strategist },
        { provide: PRODUCT_CATALOG_READER, useValue: catalog },
        { provide: COMPETITOR_SNAPSHOT_READER, useValue: competitorSnapshots },
        { provide: CHANNEL_LISTING_READER, useValue: channelListings },
        { provide: PRICE_UPDATE_DISPATCHER, useValue: dispatcher },
        { provide: FINANCIAL_POLICY_READER, useValue: financialPolicy },
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

  it('applyDecision(): sem channelCode na oportunidade — não aplica, não chama o dispatcher', async () => {
    competitorSnapshots.findOpportunity.mockResolvedValue({ ...opportunity, channelCode: null });

    const result = await service.applyDecision('tenant-1', 'SKU-001');

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(result?.applied).toBe(false);
    expect(result?.reason).toMatch(/Nenhum canal vinculado/);
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
    // costPrice 60, taxRate 6% + minProfitMargin 30% => financialFloorPrice = 60 / 0.64 = 93.75,
    // maior que os 90 que o strategist (mockado) recomendou — deve vencer.
    beforeEach(() => {
      financialPolicy.getPolicy.mockResolvedValue({ taxRate: 0.06, minProfitMargin: 0.3 });
    });

    it('decide(): sobrescreve a sugestão do strategist quando ela fura o piso financeiro', async () => {
      const result = await service.decide('tenant-1', 'SKU-001');

      expect(result?.action).toBe('FINANCIAL_FLOOR_APPLIED');
      expect(result?.recommendedPrice).toBeCloseTo(93.75, 2);
      expect(result?.hitFinancialFloor).toBe(true);
      expect(result?.reason).toMatch(/piso financeiro por proteção de margem/i);
    });

    it('applyDecision(): aplica o preço JÁ AJUSTADO pelo piso financeiro, não a sugestão original', async () => {
      const result = await service.applyDecision('tenant-1', 'SKU-001');

      const dispatchedCommand = dispatcher.dispatch.mock.calls[0][0];
      expect(dispatchedCommand.newPrice).toBeCloseTo(93.75, 2);
      expect(result?.decision.action).toBe('FINANCIAL_FLOOR_APPLIED');
    });

    it('busca a política financeira do tenant certo', async () => {
      await service.decide('tenant-42', 'SKU-001');
      expect(financialPolicy.getPolicy).toHaveBeenCalledWith('tenant-42');
    });
  });
});
