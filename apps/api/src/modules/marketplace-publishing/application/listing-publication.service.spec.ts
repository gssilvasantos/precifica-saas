import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ListingPublicationService } from './listing-publication.service';
import { ListingPublicationRepository } from './ports/listing-publication-repository.port';
import { ChannelCategoryMappingRepository } from './ports/channel-category-mapping-repository.port';
import { ListingProviderRegistry } from './listing-provider-registry.service';
import { ProductCatalogReader, ProductCatalogSummary } from '../../../shared/contracts/product-catalog-reader.port';
import { ProductCategoryReader } from '../../../shared/contracts/product-category-reader.port';
import { ChannelListingWriter } from '../../../shared/contracts/channel-listing-reader.port';
import { ListingCreateCapableProvider } from '../../../shared/contracts/marketplace-provider.contract';
import { ListingPublication } from '../domain/listing-publication.entity';

function buildProduct(overrides: Partial<ProductCatalogSummary> = {}): ProductCatalogSummary {
  return {
    productId: 'prod-1',
    skuCode: 'SKU-1',
    name: 'Produto Teste',
    costPrice: 40,
    productCostPrice: 40,
    packagingCostPrice: null,
    desiredMarginPct: 30,
    minimumMarginPct: 10,
    autoRepricingEnabled: false,
    packagingId: null,
    isKit: false,
    mapPrice: null,
    ncm: null,
    fiscalOriginCode: null,
    cest: null,
    categoryId: 'cat-1',
    photoUrls: ['https://cdn.example.com/foto.jpg'],
    weightKg: 1,
    ...overrides,
  };
}

function buildPublicationRecord(overrides: Partial<ListingPublication> = {}): ListingPublication {
  return {
    id: 'pub-1',
    tenantId: 'tenant-1',
    productId: 'prod-1',
    skuCode: 'SKU-1',
    marketplaceCode: 'MERCADO_LIVRE',
    status: 'PENDENTE',
    externalListingId: null,
    requestPayload: {},
    errorMessage: null,
    requestedAt: new Date(),
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ListingPublicationService', () => {
  function buildService(listingProvider: ListingCreateCapableProvider | undefined) {
    const publications: jest.Mocked<ListingPublicationRepository> = {
      create: jest.fn().mockResolvedValue(buildPublicationRecord()),
      findById: jest.fn(),
      findAllByProduct: jest.fn(),
      markPublished: jest.fn().mockImplementation(async (id, externalListingId) =>
        buildPublicationRecord({ id, status: 'PUBLICADO', externalListingId }),
      ),
      markError: jest.fn().mockImplementation(async (id, errorMessage) => buildPublicationRecord({ id, status: 'ERRO', errorMessage })),
    };
    const mappings: jest.Mocked<ChannelCategoryMappingRepository> = {
      upsert: jest.fn(),
      findOne: jest.fn().mockResolvedValue({
        id: 'map-1',
        tenantId: 'tenant-1',
        categoryId: 'cat-1',
        marketplaceCode: 'MERCADO_LIVRE',
        externalCategoryId: 'MLB123',
        externalCategoryName: 'Celulares',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findAllByCategory: jest.fn(),
      remove: jest.fn(),
    };
    const catalog: jest.Mocked<ProductCatalogReader> = { findBySku: jest.fn().mockResolvedValue(buildProduct()) };
    const categories: jest.Mocked<ProductCategoryReader> = {
      findById: jest.fn(),
      resolveEffectiveAttributes: jest.fn().mockResolvedValue({ Marca: 'Genérica' }),
    };
    const channelListings: jest.Mocked<ChannelListingWriter> = { upsert: jest.fn() };
    const registry = {
      findListingCreateProvider: jest.fn().mockReturnValue(listingProvider),
      findCategoryDiscoveryProvider: jest.fn().mockReturnValue({
        getCategoryAttributes: jest.fn().mockResolvedValue([{ name: 'Marca', required: true }]),
      }),
    } as unknown as jest.Mocked<ListingProviderRegistry>;

    const service = new ListingPublicationService(publications, mappings, catalog, categories, channelListings, registry);
    return { service, publications, mappings, catalog, categories, channelListings, registry };
  }

  const input = { price: 100, availableQuantity: 5 };

  it('rejeita quando nenhum provider de publicação está registrado para o canal', async () => {
    const { service } = buildService(undefined);

    await expect(service.publish('tenant-1', 'SKU-1', 'MERCADO_LIVRE', input)).rejects.toThrow(BadRequestException);
  });

  it('rejeita quando o produto não é encontrado', async () => {
    const provider = { createListing: jest.fn() } as unknown as ListingCreateCapableProvider;
    const { service, catalog } = buildService(provider);
    catalog.findBySku.mockResolvedValue(null);

    await expect(service.publish('tenant-1', 'SKU-inexistente', 'MERCADO_LIVRE', input)).rejects.toThrow(NotFoundException);
  });

  it('gate de publicação rejeita produto sem foto ANTES de criar o registro de tentativa', async () => {
    const provider = { createListing: jest.fn() } as unknown as ListingCreateCapableProvider;
    const { service, catalog, publications } = buildService(provider);
    catalog.findBySku.mockResolvedValue(buildProduct({ photoUrls: [] }));

    await expect(service.publish('tenant-1', 'SKU-1', 'MERCADO_LIVRE', input)).rejects.toThrow(BadRequestException);
    expect(publications.create).not.toHaveBeenCalled();
  });

  it('publicação com sucesso: cria tentativa, marca PUBLICADO e vincula ChannelListing', async () => {
    const provider = {
      createListing: jest.fn().mockResolvedValue({ success: true, externalListingId: 'MLB999' }),
    } as unknown as ListingCreateCapableProvider;
    const { service, publications, channelListings } = buildService(provider);

    const result = await service.publish('tenant-1', 'SKU-1', 'MERCADO_LIVRE', input);

    expect(publications.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', productId: 'prod-1', skuCode: 'SKU-1', marketplaceCode: 'MERCADO_LIVRE' }),
    );
    expect(publications.markPublished).toHaveBeenCalledWith('pub-1', 'MLB999');
    expect(channelListings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', skuCode: 'SKU-1', channelCode: 'MERCADO_LIVRE', externalId: 'MLB999' }),
    );
    expect(result.status).toBe('PUBLICADO');
  });

  it('provider recusa a publicação (success=false): marca ERRO, nunca ChannelListing', async () => {
    const provider = {
      createListing: jest.fn().mockResolvedValue({ success: false, message: 'categoria inválida' }),
    } as unknown as ListingCreateCapableProvider;
    const { service, publications, channelListings } = buildService(provider);

    const result = await service.publish('tenant-1', 'SKU-1', 'MERCADO_LIVRE', input);

    expect(publications.markError).toHaveBeenCalledWith('pub-1', 'categoria inválida');
    expect(channelListings.upsert).not.toHaveBeenCalled();
    expect(result.status).toBe('ERRO');
  });

  it('falha de comunicação (exceção) durante createListing: marca ERRO com a mensagem do erro', async () => {
    const provider = {
      createListing: jest.fn().mockRejectedValue(new Error('timeout de rede')),
    } as unknown as ListingCreateCapableProvider;
    const { service, publications } = buildService(provider);

    const result = await service.publish('tenant-1', 'SKU-1', 'MERCADO_LIVRE', input);

    expect(publications.markError).toHaveBeenCalledWith('pub-1', 'timeout de rede');
    expect(result.status).toBe('ERRO');
  });
});
