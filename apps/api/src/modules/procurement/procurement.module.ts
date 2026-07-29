import { Module } from '@nestjs/common';
import { PurchaseOrderService } from './application/purchase-order.service';
import { PrismaPurchaseOrderRepository } from './infrastructure/prisma-purchase-order.repository';
import { PurchaseOrdersController } from './interface/controllers/purchase-orders.controller';
import { PURCHASE_ORDER_REPOSITORY } from './application/ports/purchase-order-repository.port';
import { CatalogModule } from '../catalog/catalog.module';
import { LogisticsFulfillmentModule } from '../logistics-fulfillment/logistics-fulfillment.module';
import { FinancialIntelligenceModule } from '../financial-intelligence/financial-intelligence.module';

// Ordem de Compra (Fase 1, benchmark Tiny ERP, 28/07/2026) — ver
// docs/procurement-architecture.md. Módulo "consumidor puro" de três outros
// bounded contexts, cada um pela porta certa, nunca pela classe concreta:
// - CatalogModule -> SUPPLIER_REPOSITORY (valida fornecedor do tenant)
// - LogisticsFulfillmentModule -> WAREHOUSE_REPOSITORY (valida depósito do
//   tenant) + STOCK_RECEIPT_WRITER (credita estoque ao receber)
// - FinancialIntelligenceModule -> ACCOUNTS_PAYABLE_WRITER (lança a conta a
//   pagar do fornecedor ao receber)
// Sem risco de dependência circular: nenhum dos três importa ProcurementModule.
@Module({
  imports: [CatalogModule, LogisticsFulfillmentModule, FinancialIntelligenceModule],
  controllers: [PurchaseOrdersController],
  providers: [
    PurchaseOrderService,
    { provide: PURCHASE_ORDER_REPOSITORY, useClass: PrismaPurchaseOrderRepository },
  ],
})
export class ProcurementModule {}
