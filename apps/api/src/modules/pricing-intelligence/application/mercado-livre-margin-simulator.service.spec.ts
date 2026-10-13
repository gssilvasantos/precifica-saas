import { BadRequestException } from '@nestjs/common';
import { MercadoLivreMarginSimulatorService } from './mercado-livre-margin-simulator.service';
import { ProductCatalogReader, ProductCatalogSummary } from '../../../shared/contracts/product-catalog-reader.port';
import { ChannelListingReader, ChannelListingSummary } from '../../../shared/contracts/channel-listing-reader.port';
import { FeeRuleResolver, ResolvedFeeRule } from '../../../shared/contracts/fee-rule-resolver.port';
import { ChannelCategoryResolver } from '../../../shared/contracts/channel-category-resolver.port';

describe('MercadoLivreMarginSimulatorService', () => {
  const product: ProductCatalogSummary = {
    productId: 'prod-1',
    skuCode: 'RM0001',
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
    categoryId: 'cat-interna-1',
    photoUrls: [],
    weightKg: 1,
  };

  const listing: ChannelListingSummary = {
    channelCode: 'MERCADO_LIVRE',
    externalId: 'MLB123',
    currentPrice: 100,
    url: null,
  };

  const feeRule: ResolvedFeeRule = {
    tiers: [{ minPrice: 0, maxPrice: null, commissionPct: 0.12, fixedFeeAmount: 5 }],
    commissionBase: 'ITEM_PRICE',
    commissionCapAmount: null,
    ruleId: 'rule-ml-1',
    ruleVersion: 1,
  };

  let catalog: jest.Mocked<ProductCatalogReader>;
  let channelListings: jest.Mocked<ChannelListingReader>;
  let feeRules: jest.Mocked<FeeRuleResolver>;
  let channelCategories: jest.Mocked<ChannelCategoryResolver>;
  let service: MercadoLivreMarginSimulatorService;

  beforeEach(() => {
    catalog = { findBySku: jest.fn().mockResolvedValue(product) };
    channelListings = { findBySku: jest.fn().mockResolvedValue(listing), findSkusByExternalIds: jest.fn().mockResolvedValue([]) };
    feeRules = { resolveFeeRule: jest.fn().mockResolvedValue(feeRule) };
    channelCategories = { resolveExternalCategoryId: jest.fn().mockResolvedValue('MLB_EXT_1') };
    service = new MercadoLivreMarginSimulatorService(catalog, channelListings, feeRules, channelCategories);
  });

  it('traduz a categoria interna para a externa antes de resolver a taxa, e usa Clássico por padrão', async () => {
    const result = await service.simulate('tenant-1', { skuCode: 'RM0001' });

    expect(channelCategories.resolveExternalCategoryId).toHaveBeenCalledWith('tenant-1', 'cat-interna-1', 'MERCADO_LIVRE');
    expect(feeRules.resolveFeeRule).toHaveBeenCalledWith({
      marketplaceCode: 'MERCADO_LIVRE',
      categoryCode: 'MLB_EXT_1',
      tenantId: 'tenant-1',
      listingTypeId: 'gold_special',
    });
    expect(result.feeRuleFound).toBe(true);
    expect(result.listingTypeId).toBe('gold_special');
    // comissão 12% + taxa fixa 5 sobre preço 100 = 17; margem = 100-17-60 = 23
    expect(result.netMargin).toBe(23);
  });

  it('respeita listingTypeId explícito (Premium)', async () => {
    await service.simulate('tenant-1', { skuCode: 'RM0001', listingTypeId: 'gold_pro' });

    expect(feeRules.resolveFeeRule).toHaveBeenCalledWith(
      expect.objectContaining({ listingTypeId: 'gold_pro' }),
    );
  });

  it('cai para o escopo GLOBAL quando o produto não tem categoria mapeada para o ML', async () => {
    channelCategories.resolveExternalCategoryId.mockResolvedValue(null);

    await service.simulate('tenant-1', { skuCode: 'RM0001' });

    expect(feeRules.resolveFeeRule).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryCode: 'GLOBAL' }),
    );
  });

  it('sem regra validada ainda: calcula com taxa 0 e sinaliza feeRuleFound=false, nunca inventa número', async () => {
    feeRules.resolveFeeRule.mockResolvedValue(null);

    const result = await service.simulate('tenant-1', { skuCode: 'RM0001' });

    expect(result.feeRuleFound).toBe(false);
    expect(result.feeAmount).toBe(0);
    expect(result.netMargin).toBe(40); // 100 - 0 - 60
  });

  it('rejeita SKU inexistente no catálogo do tenant', async () => {
    catalog.findBySku.mockResolvedValue(null);

    await expect(service.simulate('tenant-1', { skuCode: 'INEXISTENTE' })).rejects.toThrow(BadRequestException);
  });

  it('rejeita SKU sem anúncio vinculado no Mercado Livre ainda', async () => {
    channelListings.findBySku.mockResolvedValue(null);

    await expect(service.simulate('tenant-1', { skuCode: 'RM0001' })).rejects.toThrow(BadRequestException);
  });

  it('rejeita SKU com anúncio vinculado mas sem preço ainda', async () => {
    channelListings.findBySku.mockResolvedValue({ ...listing, currentPrice: null });

    await expect(service.simulate('tenant-1', { skuCode: 'RM0001' })).rejects.toThrow(BadRequestException);
  });
});
