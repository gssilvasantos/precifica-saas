import { BadRequestException } from '@nestjs/common';
import { ShopeeMarginSimulatorService } from './shopee-margin-simulator.service';
import { ProductCatalogReader, ProductCatalogSummary } from '../../../shared/contracts/product-catalog-reader.port';
import { ChannelListingReader, ChannelListingSummary } from '../../../shared/contracts/channel-listing-reader.port';
import { FeeRuleResolver, ResolvedFeeRule } from '../../../shared/contracts/fee-rule-resolver.port';

describe('ShopeeMarginSimulatorService', () => {
  const product: ProductCatalogSummary = {
    productId: 'prod-1',
    skuCode: 'RM0002',
    name: 'Produto Teste',
    costPrice: 30,
    productCostPrice: 30,
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
    weightKg: 0.3,
  };

  const listing: ChannelListingSummary = {
    channelCode: 'SHOPEE',
    externalId: 'shopee-item-1',
    currentPrice: 90,
    url: null,
  };

  // Mesma tabela do ShopeeFeeRuleProvider (faixa R$80-99,99: 14% + R$16 fixo).
  const feeRule: ResolvedFeeRule = {
    tiers: [
      { minPrice: 0, maxPrice: 80, commissionPct: 0.2, fixedFeeAmount: 4 },
      { minPrice: 80, maxPrice: 100, commissionPct: 0.14, fixedFeeAmount: 16 },
      { minPrice: 100, maxPrice: 200, commissionPct: 0.14, fixedFeeAmount: 20 },
      { minPrice: 200, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 26 },
    ],
    commissionBase: 'ITEM_PRICE',
    commissionCapAmount: null,
    ruleId: 'rule-shopee-1',
    ruleVersion: 1,
  };

  let catalog: jest.Mocked<ProductCatalogReader>;
  let channelListings: jest.Mocked<ChannelListingReader>;
  let feeRules: jest.Mocked<FeeRuleResolver>;
  let service: ShopeeMarginSimulatorService;

  beforeEach(() => {
    catalog = { findBySku: jest.fn().mockResolvedValue(product) };
    channelListings = { findBySku: jest.fn().mockResolvedValue(listing), findSkusByExternalIds: jest.fn().mockResolvedValue([]) };
    feeRules = { resolveFeeRule: jest.fn().mockResolvedValue(feeRule) };
    service = new ShopeeMarginSimulatorService(catalog, channelListings, feeRules);
  });

  it('resolve a taxa pelo escopo GLOBAL (Shopee não diferencia por categoria) e calcula a margem pela faixa de preço certa', async () => {
    const result = await service.simulate('tenant-1', { skuCode: 'RM0002' });

    expect(feeRules.resolveFeeRule).toHaveBeenCalledWith({
      marketplaceCode: 'SHOPEE',
      categoryCode: 'GLOBAL',
      tenantId: 'tenant-1',
    });
    // Preço 90 cai na faixa 80-99,99: 14% * 90 + 16 = 12,6 + 16 = 28,6
    expect(result.feeAmount).toBe(28.6);
    expect(result.netMargin).toBe(90 - 28.6 - 30);
    expect(result.feeRuleFound).toBe(true);
  });

  it('sem regra validada ainda: calcula com taxa 0 e sinaliza feeRuleFound=false', async () => {
    feeRules.resolveFeeRule.mockResolvedValue(null);

    const result = await service.simulate('tenant-1', { skuCode: 'RM0002' });

    expect(result.feeRuleFound).toBe(false);
    expect(result.feeAmount).toBe(0);
    expect(result.netMargin).toBe(60); // 90 - 0 - 30
  });

  it('rejeita SKU inexistente no catálogo do tenant', async () => {
    catalog.findBySku.mockResolvedValue(null);

    await expect(service.simulate('tenant-1', { skuCode: 'INEXISTENTE' })).rejects.toThrow(BadRequestException);
  });

  it('rejeita SKU sem anúncio vinculado na Shopee ainda', async () => {
    channelListings.findBySku.mockResolvedValue(null);

    await expect(service.simulate('tenant-1', { skuCode: 'RM0002' })).rejects.toThrow(BadRequestException);
  });
});
