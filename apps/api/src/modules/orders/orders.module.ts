import { Module } from '@nestjs/common';
import { OrdersService } from './application/orders.service';
import { OrderSyncOrchestrator } from './application/order-sync-orchestrator.service';
import { OrderProviderRegistry, ORDER_CAPABLE_PROVIDERS } from './application/order-provider-registry.service';
import { PrismaOrderRepository } from './infrastructure/prisma-order.repository';
import { OrdersSyncSchedulerJob } from './infrastructure/scheduler/orders-sync-scheduler.job';
import { MercadoLivreShipmentEnrichmentJob } from './infrastructure/scheduler/mercado-livre-shipment-enrichment.job';
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
import { ShopeeOrderProvider } from '../marketplace-intelligence/infrastructure/providers/shopee/shopee-order.provider';
import { WebhooksController } from './interface/controllers/webhooks.controller';
import { ORDER_FINANCIALS_READER } from '../../shared/contracts/tokens';
import { ORDER_FISCAL_READER } from '../../shared/contracts/order-fiscal-reader.port';
import { ORDER_COMMISSION_WRITER } from '../../shared/contracts/order-commission-writer.port';
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
    // Reestruturação do sync ML (25-26/07/2026, ver README) — a metade
    // resumível/assíncrona do enriquecimento de status de envio. Consome
    // MercadoLivreApiClient/MercadoLivreConnectionService, ambos exportados
    // por MarketplaceIntelligenceModule (import acima) especificamente para
    // este job.
    MercadoLivreShipmentEnrichmentJob,
    AuditSeederService,
    {
      provide: ORDER_CAPABLE_PROVIDERS,
      // Shopee (27/07/2026) — mesma receita comentada acima: nenhuma linha de
      // OrderProviderRegistry/OrderSyncOrchestrator mudou para este canal
      // entrar, só mais um provider nesta lista + injeção abaixo.
      useFactory: (nuvemshop: NuvemshopOrderProvider, mercadoLivre: MercadoLivreOrderProvider, shopee: ShopeeOrderProvider) => [
        nuvemshop,
        mercadoLivre,
        shopee,
      ],
      inject: [NuvemshopOrderProvider, MercadoLivreOrderProvider, ShopeeOrderProvider],
    },
    { provide: ORDER_REPOSITORY, useClass: PrismaOrderRepository },
    // Etapa 20 — expõe OrdersService também como a implementação da porta
    // ORDER_FINANCIALS_READER (useExisting: MESMA instância, não uma
    // segunda). Consumido pelo FinancialOrchestrator (Financial
    // Intelligence) para montar o DRE — ver financial-intelligence.module.ts.
    { provide: ORDER_FINANCIALS_READER, useExisting: OrdersService },
    // Fase 3 (benchmark Tiny ERP, Emissão de NF-e) — expõe a PORTA (token),
    // nunca a classe concreta — o módulo fiscal só vai conhecer
    // ORDER_FISCAL_READER + a interface OrderFiscalReader.
    { provide: ORDER_FISCAL_READER, useExisting: OrdersService },
    // Vendedores + Comissão (Projeto Estruturante 3, benchmark Bling ERP,
    // 29/07/2026) — expõe a PORTA (token), nunca a classe concreta — o
    // módulo sellers (CommissionService) só vai conhecer
    // ORDER_COMMISSION_WRITER + a interface OrderCommissionWriter. Módulo
    // sellers importa OrdersModule (nunca o contrário) — sem risco de
    // dependência circular.
    { provide: ORDER_COMMISSION_WRITER, useExisting: OrdersService },
  ],
  // OrderProviderRegistry exportado (29/07/2026, Fase 5 — Expedição em
  // lote) — DispatchBatchService (logistics-fulfillment) reaproveita o
  // MESMO registry (via findByMarketplaceCode + isShippingLabelCapable) para
  // buscar a etiqueta NATIVA do canal, em vez de duplicar um registry novo
  // só para essa capacidade.
  exports: [ORDER_FINANCIALS_READER, ORDER_FISCAL_READER, ORDER_COMMISSION_WRITER, OrderProviderRegistry],
})
export class OrdersModule {}
