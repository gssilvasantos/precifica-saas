import { Module } from '@nestjs/common';
import { ProductionOrderService } from './application/production-order.service';
import { PrismaProductionOrderRepository } from './infrastructure/prisma-production-order.repository';
import { ProductionOrdersController } from './interface/controllers/production-orders.controller';
import { PRODUCTION_ORDER_REPOSITORY } from './application/ports/production-order-repository.port';
import { CatalogModule } from '../catalog/catalog.module';
import { LogisticsFulfillmentModule } from '../logistics-fulfillment/logistics-fulfillment.module';

// Ordens de Produção — Projeto Estruturante 1, benchmark Bling ERP,
// 29/07/2026 (docs/bling-erp-benchmark-analysis.md, seção 1.1, e
// docs/production-architecture.md). Bounded context PRÓPRIO (schema Prisma
// "production"): fecha o ciclo entre a BOM (CatalogModule, exporta
// PRODUCT_CATALOG_READER + PRODUCT_STRUCTURE_READER) e o Hub de Provas
// (LogisticsFulfillmentModule, exporta WAREHOUSE_REPOSITORY +
// PRODUCTION_STOCK_WRITER) — ProductionOrderService só conhece essas 4
// portas via @Inject, nunca a classe concreta de nenhum dos dois módulos,
// mesmo padrão de ProcurementModule.
@Module({
  imports: [CatalogModule, LogisticsFulfillmentModule],
  controllers: [ProductionOrdersController],
  providers: [
    ProductionOrderService,
    { provide: PRODUCTION_ORDER_REPOSITORY, useClass: PrismaProductionOrderRepository },
  ],
  exports: [],
})
export class ProductionModule {}
