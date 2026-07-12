import { Module } from '@nestjs/common';
import { OrdersService } from './application/orders.service';
import { OrderSyncOrchestrator } from './application/order-sync-orchestrator.service';
import { OrderProviderRegistry, ORDER_CAPABLE_PROVIDERS } from './application/order-provider-registry.service';
import { PrismaOrderRepository } from './infrastructure/prisma-order.repository';
import { OrdersSyncSchedulerJob } from './infrastructure/scheduler/orders-sync-scheduler.job';
import { OrdersController } from './interface/controllers/orders.controller';
import { OrdersSyncController } from './interface/controllers/orders-sync.controller';
import { AuditModeController } from './interface/controllers/audit-mode.controller';
import { AuditSeederService } from './application/audit-seeder.service';
import { ORDER_REPOSITORY } from './application/ports/order-repository.port';
import { SyncOpsModule } from '../../shared/sync-ops/sync-ops.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';
import { NuvemshopOrderProvider } from '../erp-integration/infrastructure/nuvemshop/nuvemshop-order.provider';
import { MarketplaceIntelligenceModule } from '../marketplace-intelligence/marketplace-intelligence.module';
import { MercadoLivreOrderProvider } from '../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-order.provider';
import { WebhooksController } from './interface/controllers/webhooks.controller';
import { ORDER_FINANCIALS_READER } from '../../shared/contracts/tokens';
import { ObservabilityModule } from '../../shared/observability/observability.module';

// Hub de pedidos multicanal (docs/orders-architecture.md). Mesmo padrão de
// composição do Marketplace Intelligence: importa ErpIntegrationModule
// (NuvemshopOrderProvider) e MarketplaceIntelligenceModule
// (MercadoLivreOrderProvider, Sprint 21) só para registrar cada provider
// (exportado de lá, nunca a classe concreta reimplementada aqui) em
// ORDER_CAPABLE_PROVIDERS — adicionar um canal novo (Shopee, TikTok...) é
// acrescentar mais um provider nesta lista + mais uma entrada no
// useFactory abaixo, nunca alterar OrderProviderRegistry nem
// OrderSyncOrchestrator. Nenhum import circular: nem ErpIntegrationModule
// nem MarketplaceIntelligenceModule importa OrdersModule de volta.
@Module({
  imports: [
    SyncOpsModule, // agenda/log/saúde de sync — mesma infra genérica do resto da plataforma
    CatalogModule, // só para consumir PRODUCT_CATALOG_READER (resolução best-effort de SKU por item)
    ErpIntegrationModule, // só para consumir NuvemshopOrderProvider (exportado de lá)
    MarketplaceIntelligenceModule, // só para consumir MercadoLivreOrderProvider (exportado de lá)
    ObservabilityModule, // só para consumir ALERT_SERVICE (alerta técnico em falha de sync)
  ],
  controllers: [OrdersController, OrdersSyncController, WebhooksController, AuditModeController],
  providers: [
    OrdersService,
    OrderSyncOrchestrator,
    OrderProviderRegistry,
    OrdersSyncSchedulerJob,
    AuditSeederService,
    {
      provide: ORDER_CAPABLE_PROVIDERS,
      useFactory: (nuvemshop: NuvemshopOrderProvider, mercadoLivre: MercadoLivreOrderProvider) => [nuvemshop, mercadoLivre],
      inject: [NuvemshopOrderProvider, MercadoLivreOrderProvider],
    },
    { provide: ORDER_REPOSITORY, useClass: PrismaOrderRepository },
    // Etapa 20 — expõe OrdersService também como a implementação da porta
    // ORDER_FINANCIALS_READER (useExisting: MESMA instância, não uma
    // segunda). Consumido pelo FinancialOrchestrator (Financial
    // Intelligence) para montar o DRE — ver financial-intelligence.module.ts.
    { provide: ORDER_FINANCIALS_READER, useExisting: OrdersService },
  ],
  exports: [ORDER_FINANCIALS_READER],
})
export class OrdersModule {}
