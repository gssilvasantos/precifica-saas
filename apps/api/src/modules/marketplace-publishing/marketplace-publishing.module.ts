import { Module } from '@nestjs/common';
import { ChannelCategoryMappingService } from './application/channel-category-mapping.service';
import { ChannelCategoryResolverService } from './application/channel-category-resolver.service';
import { ListingPublicationService } from './application/listing-publication.service';
import { CHANNEL_CATEGORY_RESOLVER } from '../../shared/contracts/tokens';
import { ListingProviderRegistry, LISTING_CAPABLE_PROVIDERS } from './application/listing-provider-registry.service';
import { CHANNEL_CATEGORY_MAPPING_REPOSITORY } from './application/ports/channel-category-mapping-repository.port';
import { LISTING_PUBLICATION_REPOSITORY } from './application/ports/listing-publication-repository.port';
import { PrismaChannelCategoryMappingRepository } from './infrastructure/prisma-channel-category-mapping.repository';
import { PrismaListingPublicationRepository } from './infrastructure/prisma-listing-publication.repository';
import { ChannelCategoryMappingsController } from './interface/controllers/channel-category-mappings.controller';
import { ListingPublicationsController } from './interface/controllers/listing-publications.controller';

import { CatalogModule } from '../catalog/catalog.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';
import { MarketplaceIntelligenceModule } from '../marketplace-intelligence/marketplace-intelligence.module';
import { MercadoLivreListingProvider } from '../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-listing.provider';
import { ShopeeListingProvider } from '../marketplace-intelligence/infrastructure/providers/shopee/shopee-listing.provider';

// Publicar anúncio novo em marketplace (Fase 4, benchmark Tiny ERP,
// 28/07/2026) — ver docs/marketplace-listing-publish-architecture.md. Mesmo
// padrão de composição do resto da plataforma (ex.: OrdersModule): importa
// CatalogModule (PRODUCT_CATEGORY_READER + PRODUCT_CATALOG_READER),
// ErpIntegrationModule (CHANNEL_LISTING_WRITER) e MarketplaceIntelligenceModule
// (MercadoLivreListingProvider/ShopeeListingProvider) só para consumir cada
// porta/classe exportada de lá — nenhum import circular, nenhum desses três
// módulos importa este de volta.
@Module({
  imports: [CatalogModule, ErpIntegrationModule, MarketplaceIntelligenceModule],
  controllers: [ChannelCategoryMappingsController, ListingPublicationsController],
  providers: [
    ChannelCategoryMappingService,
    ListingPublicationService,
    ListingProviderRegistry,
    { provide: CHANNEL_CATEGORY_MAPPING_REPOSITORY, useClass: PrismaChannelCategoryMappingRepository },
    { provide: LISTING_PUBLICATION_REPOSITORY, useClass: PrismaListingPublicationRepository },
    // Registro central de providers de publicação — adicionar um canal novo
    // (Amazon, Magalu...) é registrar mais uma linha aqui, nunca alterar
    // ListingProviderRegistry/ChannelCategoryMappingService/ListingPublicationService.
    {
      provide: LISTING_CAPABLE_PROVIDERS,
      useFactory: (ml: MercadoLivreListingProvider, shopee: ShopeeListingProvider) => [ml, shopee],
      inject: [MercadoLivreListingProvider, ShopeeListingProvider],
    },
    // Porta consumida pelo Pricing Intelligence para resolver a comissão
    // correta por categoria do canal (01/08/2026) — ver
    // shared/contracts/channel-category-resolver.port.ts.
    { provide: CHANNEL_CATEGORY_RESOLVER, useClass: ChannelCategoryResolverService },
    ChannelCategoryResolverService,
  ],
  exports: [CHANNEL_CATEGORY_RESOLVER],
})
export class MarketplacePublishingModule {}
