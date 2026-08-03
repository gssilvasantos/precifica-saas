import { Module } from '@nestjs/common';
import { WarehouseService } from './application/warehouse.service';
import { ProductWarehouseLocationService } from './application/product-warehouse-location.service';
import { StockMovementAuditEventService } from './application/stock-movement-audit-event.service';
import { VideoCaptureService } from './application/video-capture.service';
import { OrderReadyForFulfillmentListener } from './application/order-ready-for-fulfillment.listener';
import { ReplenishmentAdvisorService } from './application/replenishment-advisor.service';
import { LogisticsCostReaderService } from './application/logistics-cost-reader.service';
import { DispatchBatchService } from './application/dispatch-batch.service';
import { LotAvailabilityService } from './application/lot-availability.service';

import { PrismaWarehouseRepository } from './infrastructure/prisma-warehouse.repository';
import { PrismaProductWarehouseLocationRepository } from './infrastructure/prisma-product-warehouse-location.repository';
import { PrismaStockMovementAuditEventRepository } from './infrastructure/prisma-stock-movement-audit-event.repository';
import { PrismaStockMovementAuditEventItemRepository } from './infrastructure/prisma-stock-movement-audit-event-item.repository';
import { PrismaVideoCaptureSessionRepository } from './infrastructure/prisma-video-capture-session.repository';
import { PrismaStockLedgerRepository } from './infrastructure/prisma-stock-ledger.repository';
import { PrismaDispatchBatchRepository } from './infrastructure/prisma-dispatch-batch.repository';
import { PrismaDispatchBatchOrderRepository } from './infrastructure/prisma-dispatch-batch-order.repository';
import { LocalVideoChunkStorageService } from './infrastructure/local-video-chunk-storage.service';
import { R2VideoChunkStorageService } from './infrastructure/r2-video-chunk-storage.service';
import { resolveStorageDriver } from '../../shared/config/storage-environment';
import { VideoRetentionCleanupJob } from './infrastructure/scheduler/video-retention-cleanup.job';

import { StockMovementAuditEventController } from './interface/controllers/stock-movement-audit-event.controller';
import { WarehousesController } from './interface/controllers/warehouses.controller';
import { ReplenishmentController } from './interface/controllers/replenishment.controller';
import { DispatchBatchesController } from './interface/controllers/dispatch-batches.controller';
import { LotStockController } from './interface/controllers/lot-stock.controller';

import { WAREHOUSE_REPOSITORY } from './application/ports/warehouse-repository.port';
import { PRODUCT_WAREHOUSE_LOCATION_REPOSITORY } from './application/ports/product-warehouse-location-repository.port';
import { STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY } from './application/ports/stock-movement-audit-event-repository.port';
import { STOCK_MOVEMENT_AUDIT_EVENT_ITEM_REPOSITORY } from './application/ports/stock-movement-audit-event-item-repository.port';
import { VIDEO_CAPTURE_SESSION_REPOSITORY } from './application/ports/video-capture-session-repository.port';
import { VIDEO_CHUNK_STORAGE } from './application/ports/video-chunk-storage.port';
import { STOCK_LEDGER_REPOSITORY } from './application/ports/stock-ledger-repository.port';
import { DISPATCH_BATCH_REPOSITORY } from './application/ports/dispatch-batch-repository.port';
import { DISPATCH_BATCH_ORDER_REPOSITORY } from './application/ports/dispatch-batch-order-repository.port';

import { ObservabilityModule } from '../../shared/observability/observability.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';
import { OrdersModule } from '../orders/orders.module';
import { CatalogModule } from '../catalog/catalog.module';
import { FreightShippingModule } from '../freight-shipping/freight-shipping.module';
import { LOGISTICS_COST_READER } from '../../shared/contracts/tokens';
import { STOCK_RECEIPT_WRITER } from '../../shared/contracts/stock-receipt-writer.port';
import { PRODUCTION_STOCK_WRITER } from '../../shared/contracts/production-stock-writer.port';

// Módulo do "Hub de Provas" + Full Fulfillment (Sprint 24) + Inteligência
// de Abastecimento (Sprint 25) + Motor de Custo Logístico para Promoções
// (Sprint 26). Ver docs/logistics-fulfillment-architecture.md.
//
// Importa ErpIntegrationModule só para consumir FILE_STORAGE (mídia da
// conferência) — nunca nenhuma classe concreta daquele módulo, mesmo
// racional de qualquer outro consumo de porta entre módulos nesta base.
// Importa ObservabilityModule pelo mesmo motivo de todo caminho de
// falha/divergência já existente (OrderSyncOrchestrator, MercadoLivreConnectionService):
// AlertService é o único jeito documentado de sinalizar problema técnico
// sem depender de alguém checar log manualmente.
// Importa OrdersModule (Sprint 25) só para consumir ORDER_FINANCIALS_READER
// — MESMA porta que já alimenta o DRE (Etapa 20/FinancialIntelligenceModule)
// — o giro por SKU/canal vem dela, nunca de uma porta nova duplicada.
// Importa CatalogModule (Sprint 26) só para consumir PRODUCT_CATALOG_READER
// + PACKAGING_COST_READER — LogisticsCostReaderService precisa das duas para
// resolver a hierarquia de custo de embalagem. Desde o Projeto Estruturante 2
// (Produtos-Lotes, 29/07/2026), também consome PRODUCT_LOT_READER
// (StockMovementAuditEventService.adjustLot + LotAvailabilityService). Sem
// dependência circular: CatalogModule não importa LogisticsFulfillmentModule
// de volta.
@Module({
  imports: [ObservabilityModule, ErpIntegrationModule, OrdersModule, CatalogModule, FreightShippingModule],
  controllers: [
    StockMovementAuditEventController,
    WarehousesController,
    ReplenishmentController,
    DispatchBatchesController,
    LotStockController,
  ],
  providers: [
    WarehouseService,
    ProductWarehouseLocationService,
    StockMovementAuditEventService,
    VideoCaptureService,
    OrderReadyForFulfillmentListener,
    ReplenishmentAdvisorService,
    LogisticsCostReaderService,
    VideoRetentionCleanupJob,
    DispatchBatchService,
    // Produtos-Lotes (Projeto Estruturante 2) — saldo por lote + sugestão
    // FEFO, só leitura (ver lot-availability.service.ts).
    LotAvailabilityService,

    { provide: WAREHOUSE_REPOSITORY, useClass: PrismaWarehouseRepository },
    { provide: PRODUCT_WAREHOUSE_LOCATION_REPOSITORY, useClass: PrismaProductWarehouseLocationRepository },
    { provide: STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY, useClass: PrismaStockMovementAuditEventRepository },
    { provide: STOCK_MOVEMENT_AUDIT_EVENT_ITEM_REPOSITORY, useClass: PrismaStockMovementAuditEventItemRepository },
    { provide: VIDEO_CAPTURE_SESSION_REPOSITORY, useClass: PrismaVideoCaptureSessionRepository },
    // Passo 3 (Deploy Demo) — mesmo racional do FILE_STORAGE em
    // ErpIntegrationModule: troca disco local por R2 (multipart upload) em
    // runtime via resolveStorageDriver(). Ver
    // docs/deploy-render-supabase-r2.md, seção 3.
    {
      provide: VIDEO_CHUNK_STORAGE,
      useFactory: () =>
        resolveStorageDriver() === 'r2' ? new R2VideoChunkStorageService() : new LocalVideoChunkStorageService(),
    },
    { provide: STOCK_LEDGER_REPOSITORY, useClass: PrismaStockLedgerRepository },
    { provide: DISPATCH_BATCH_REPOSITORY, useClass: PrismaDispatchBatchRepository },
    { provide: DISPATCH_BATCH_ORDER_REPOSITORY, useClass: PrismaDispatchBatchOrderRepository },
    // Exporta a PORTA (token), nunca a classe concreta — o Promotion
    // Intelligence só vai conhecer LOGISTICS_COST_READER + a interface.
    { provide: LOGISTICS_COST_READER, useExisting: LogisticsCostReaderService },
    // Ordem de Compra (Fase 1) — StockMovementAuditEventService implementa
    // StockReceiptWriter (receivePurchase); exporta a PORTA, nunca a classe
    // concreta, mesmo padrão de LOGISTICS_COST_READER acima.
    { provide: STOCK_RECEIPT_WRITER, useExisting: StockMovementAuditEventService },
    // Ordem de Produção (Projeto Estruturante 1) — StockMovementAuditEventService
    // implementa ProductionStockWriter (produceOutput); exporta a PORTA,
    // nunca a classe concreta, mesmo padrão de STOCK_RECEIPT_WRITER acima.
    { provide: PRODUCTION_STOCK_WRITER, useExisting: StockMovementAuditEventService },
  ],
  exports: [
    LOGISTICS_COST_READER,
    STOCK_RECEIPT_WRITER,
    PRODUCTION_STOCK_WRITER,
    // Ordem de Compra (Fase 1) — PurchaseOrderService precisa validar que um
    // warehouseId informado pertence ao tenant antes de gravar, mesmo
    // racional de CatalogModule exportando SUPPLIER_REPOSITORY para
    // AccountsPayableService.
    WAREHOUSE_REPOSITORY,
  ],
})
export class LogisticsFulfillmentModule {}
