import { Module } from '@nestjs/common';
import { OlistConnectionService } from './application/olist-connection.service';
import { ErpSyncOrchestrator } from './application/erp-sync-orchestrator.service';
import { ErpSyncEventsQueryService } from './application/erp-sync-events-query.service';
import { ProductPhotoMirrorService } from './application/product-photo-mirror.service';
import { NuvemshopConnectionService } from './application/nuvemshop-connection.service';
import { NuvemshopChannelListingSyncService } from './application/nuvemshop-channel-listing-sync.service';
import { ChannelListingReaderService } from './application/channel-listing-reader.service';
import { ChannelListingsQueryService } from './application/channel-listings-query.service';

import { PrismaOlistConnectionRepository } from './infrastructure/prisma-olist-connection.repository';
import { PrismaErpSyncChangeEventRepository } from './infrastructure/prisma-erp-sync-change-event.repository';
import { PrismaNuvemshopConnectionRepository } from './infrastructure/prisma-nuvemshop-connection.repository';
import { PrismaChannelListingRepository } from './infrastructure/prisma-channel-listing.repository';
import { OlistApiClient } from './infrastructure/olist/olist-api.client';
import { NuvemshopApiClient } from './infrastructure/nuvemshop/nuvemshop-api.client';
import { NuvemshopFeeRuleProvider } from './infrastructure/nuvemshop/nuvemshop-fee-rule.provider';
import { NuvemshopOrderProvider } from './infrastructure/nuvemshop/nuvemshop-order.provider';
import { LocalFileStorageService } from './infrastructure/storage/local-file-storage.service';
import { R2FileStorageService } from './infrastructure/storage/r2-file-storage.service';
import { resolveStorageDriver } from '../../shared/config/storage-environment';
import { ErpSyncSchedulerJob } from './infrastructure/scheduler/erp-sync-scheduler.job';
import { NuvemshopSyncSchedulerJob } from './infrastructure/scheduler/nuvemshop-sync-scheduler.job';

import { OlistConnectionController } from './interface/controllers/olist-connection.controller';
import { NuvemshopConnectionController } from './interface/controllers/nuvemshop-connection.controller';
import { ChannelListingsController } from './interface/controllers/channel-listings.controller';

import { OLIST_CONNECTION_REPOSITORY } from './application/ports/olist-connection-repository.port';
import { ERP_SYNC_CHANGE_EVENT_REPOSITORY } from './application/ports/erp-sync-change-event-repository.port';
import { NUVEMSHOP_CONNECTION_REPOSITORY } from './application/ports/nuvemshop-connection-repository.port';
import { CHANNEL_LISTING_REPOSITORY } from './application/ports/channel-listing-repository.port';
import { FILE_STORAGE, CHANNEL_LISTING_READER } from '../../shared/contracts/tokens';
import { CredentialEncryptionService } from '../../shared/security/credential-encryption.service';
import { SyncOpsModule } from '../../shared/sync-ops/sync-ops.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [
    SyncOpsModule, // agenda/log/saúde de sync — mesma infra genérica usada pelo Marketplace Intelligence
    CatalogModule, // só para consumir PRODUCT_CATALOG_WRITER — nunca a tabela Product direto
  ],
  controllers: [OlistConnectionController, NuvemshopConnectionController, ChannelListingsController],
  providers: [
    OlistConnectionService,
    ErpSyncOrchestrator,
    ErpSyncEventsQueryService,
    ProductPhotoMirrorService,
    NuvemshopConnectionService,
    NuvemshopChannelListingSyncService,
    ChannelListingReaderService,
    ChannelListingsQueryService,
    CredentialEncryptionService,

    OlistApiClient,
    NuvemshopApiClient,
    // NuvemshopFeeRuleProvider mora aqui (não em marketplace-intelligence)
    // porque precisa do mesmo NuvemshopApiClient/credenciais deste módulo —
    // é EXPORTADO para o Marketplace Intelligence registrar no seu
    // MARKETPLACE_PROVIDERS, sem este módulo precisar importar aquele de
    // volta (evita dependência circular entre os dois).
    NuvemshopFeeRuleProvider,
    // Mesmo racional de NuvemshopFeeRuleProvider: exportado para o módulo
    // Orders registrar em ORDER_CAPABLE_PROVIDERS sem import circular.
    NuvemshopOrderProvider,
    ErpSyncSchedulerJob,
    NuvemshopSyncSchedulerJob,

    { provide: OLIST_CONNECTION_REPOSITORY, useClass: PrismaOlistConnectionRepository },
    { provide: ERP_SYNC_CHANGE_EVENT_REPOSITORY, useClass: PrismaErpSyncChangeEventRepository },
    { provide: NUVEMSHOP_CONNECTION_REPOSITORY, useClass: PrismaNuvemshopConnectionRepository },
    { provide: CHANNEL_LISTING_REPOSITORY, useClass: PrismaChannelListingRepository },
    // Passo 3 (Deploy Demo) — troca disco local por R2 em runtime via
    // resolveStorageDriver() (STORAGE_DRIVER explícito, ou NODE_ENV como
    // fallback). useFactory em vez de useClass porque a escolha depende de
    // env var lida em runtime, não é fixa em tempo de compilação; nenhum
    // consumidor (ProductPhotoMirrorService) muda — ambos implementam a
    // mesma porta FileStorage (shared/contracts/file-storage.port.ts). Ver
    // docs/deploy-render-supabase-r2.md, seção 3.
    {
      provide: FILE_STORAGE,
      useFactory: () => (resolveStorageDriver() === 'r2' ? new R2FileStorageService() : new LocalFileStorageService()),
    },
    { provide: CHANNEL_LISTING_READER, useExisting: ChannelListingReaderService },
  ],
  // FILE_STORAGE exportado a partir da Sprint 24 — o módulo
  // logistics-fulfillment (Hub de Provas) precisa persistir a mídia
  // (foto/vídeo) anexada na conferência, e reaproveita este mesmo adapter
  // de disco local em vez de duplicar a porta/implementação.
  //
  // CredentialEncryptionService exportado a partir do deploy Demo (bug de DI
  // pego só em runtime no Render — nest build não pega isso porque o
  // container de DI do Nest só é montado no boot, nunca em tsc/build). Mesmo
  // racional de NuvemshopFeeRuleProvider/NuvemshopOrderProvider/FILE_STORAGE
  // acima: MarketplaceIntelligenceModule já importa ErpIntegrationModule
  // (só para consumir NuvemshopFeeRuleProvider), e MercadoLivreConnectionService
  // (dentro daquele módulo) também depende deste serviço para
  // criptografar/descriptografar o access/refresh token do Mercado Livre em
  // repouso — sem exportar aqui, o Nest não consegue resolver essa
  // dependência fora deste módulo, mesmo com a classe registrada em
  // `providers`. Ver docs/auth-security.md.
  exports: [CHANNEL_LISTING_READER, NuvemshopFeeRuleProvider, NuvemshopOrderProvider, FILE_STORAGE, CredentialEncryptionService],
})
export class ErpIntegrationModule {}
