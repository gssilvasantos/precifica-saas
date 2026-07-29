import { Inject, Injectable } from '@nestjs/common';
import {
  CategoryDiscoveryCapableProvider,
  ListingCreateCapableProvider,
  MarketplaceProvider,
  isCategoryDiscoveryCapable,
  isListingCreateCapable,
} from '../../../shared/contracts/marketplace-provider.contract';

export const LISTING_CAPABLE_PROVIDERS = Symbol('LISTING_CAPABLE_PROVIDERS');

// Registry multi-provider — MESMO padrão de OrderProviderRegistry
// (módulo Orders): adicionar um canal novo é registrar mais um provider no
// token LISTING_CAPABLE_PROVIDERS (module), nunca alterar esta classe nem
// os services que a consomem (ChannelCategoryMappingService/
// ListingPublicationService). Cada provider aqui (ex.:
// MercadoLivreListingProvider) tipicamente implementa AMBAS as capacidades
// (CategoryDiscoveryCapableProvider + ListingCreateCapableProvider) na
// mesma classe — mas o registry não assume isso: cada find* checa a
// capacidade específica via type-guard antes de devolver.
@Injectable()
export class ListingProviderRegistry {
  constructor(@Inject(LISTING_CAPABLE_PROVIDERS) private readonly providers: MarketplaceProvider[]) {}

  findCategoryDiscoveryProvider(marketplaceCode: string): CategoryDiscoveryCapableProvider | undefined {
    const normalized = marketplaceCode.toUpperCase();
    return this.providers.find((p) => p.marketplaceCode === normalized && isCategoryDiscoveryCapable(p)) as
      | CategoryDiscoveryCapableProvider
      | undefined;
  }

  findListingCreateProvider(marketplaceCode: string): ListingCreateCapableProvider | undefined {
    const normalized = marketplaceCode.toUpperCase();
    return this.providers.find((p) => p.marketplaceCode === normalized && isListingCreateCapable(p)) as
      | ListingCreateCapableProvider
      | undefined;
  }
}
