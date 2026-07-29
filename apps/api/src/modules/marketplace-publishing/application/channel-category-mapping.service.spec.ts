import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ChannelCategoryMappingService } from './channel-category-mapping.service';
import { ChannelCategoryMappingRepository } from './ports/channel-category-mapping-repository.port';
import { ListingProviderRegistry } from './listing-provider-registry.service';
import { ProductCategoryReader } from '../../../shared/contracts/product-category-reader.port';
import { CategoryDiscoveryCapableProvider, ProviderCapability } from '../../../shared/contracts/marketplace-provider.contract';

function buildProvider(overrides: Partial<CategoryDiscoveryCapableProvider> = {}): CategoryDiscoveryCapableProvider {
  return {
    code: 'ML_LISTING',
    marketplaceCode: 'MERCADO_LIVRE',
    sourceType: 'OFFICIAL_API',
    capabilities: [ProviderCapability.CATEGORY_DISCOVERY],
    healthCheck: jest.fn(),
    searchCategories: jest.fn().mockResolvedValue([{ externalCategoryId: 'MLB123', name: 'Celulares' }]),
    getCategoryAttributes: jest.fn().mockResolvedValue([{ name: 'Marca', required: true }]),
    ...overrides,
  };
}

describe('ChannelCategoryMappingService', () => {
  function buildService(provider: CategoryDiscoveryCapableProvider | undefined) {
    const mappings: jest.Mocked<ChannelCategoryMappingRepository> = {
      upsert: jest.fn(),
      findOne: jest.fn(),
      findAllByCategory: jest.fn(),
      remove: jest.fn(),
    };
    const categories: jest.Mocked<ProductCategoryReader> = {
      findById: jest.fn(),
      resolveEffectiveAttributes: jest.fn(),
    };
    const registry = { findCategoryDiscoveryProvider: jest.fn().mockReturnValue(provider) } as unknown as jest.Mocked<ListingProviderRegistry>;

    const service = new ChannelCategoryMappingService(mappings, categories, registry);
    return { service, mappings, categories, registry };
  }

  it('searchExternalCategories delega para o provider do canal', async () => {
    const provider = buildProvider();
    const { service } = buildService(provider);

    const result = await service.searchExternalCategories('mercado_livre', 'celular');

    expect(provider.searchCategories).toHaveBeenCalledWith({ marketplaceCode: 'mercado_livre' }, 'celular');
    expect(result).toEqual([{ externalCategoryId: 'MLB123', name: 'Celulares' }]);
  });

  it('rejeita busca quando nenhum provider de descoberta está registrado para o canal', async () => {
    const { service } = buildService(undefined);

    await expect(service.searchExternalCategories('amazon', 'qualquer')).rejects.toThrow(BadRequestException);
  });

  it('setMapping rejeita quando a categoria não existe para o tenant', async () => {
    const { service, categories } = buildService(buildProvider());
    categories.findById.mockResolvedValue(null);

    await expect(service.setMapping('tenant-1', 'cat-inexistente', 'MERCADO_LIVRE', 'MLB123', 'Celulares')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('setMapping faz upsert com marketplaceCode normalizado quando a categoria existe', async () => {
    const { service, categories, mappings } = buildService(buildProvider());
    categories.findById.mockResolvedValue({ id: 'cat-1', name: 'Eletrônicos', parentCategoryId: null });
    mappings.upsert.mockResolvedValue({
      id: 'map-1',
      tenantId: 'tenant-1',
      categoryId: 'cat-1',
      marketplaceCode: 'MERCADO_LIVRE',
      externalCategoryId: 'MLB123',
      externalCategoryName: 'Celulares',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.setMapping('tenant-1', 'cat-1', 'mercado_livre', 'MLB123', 'Celulares');

    expect(mappings.upsert).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      categoryId: 'cat-1',
      marketplaceCode: 'MERCADO_LIVRE',
      externalCategoryId: 'MLB123',
      externalCategoryName: 'Celulares',
    });
  });
});
