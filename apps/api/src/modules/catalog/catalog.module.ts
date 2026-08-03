import { Module } from '@nestjs/common';
import { ProductsService } from './application/products.service';
import { SuppliersService } from './application/suppliers.service';
import { TaxProfilesService } from './application/tax-profiles.service';
import { CatalogSettingsService } from './application/catalog-settings.service';
import { CatalogSyncWriterService } from './application/catalog-sync-writer.service';
import { CatalogReaderService } from './application/catalog-reader.service';
import { FinancialPolicyReaderService } from './application/financial-policy-reader.service';
import { PackagingsService } from './application/packaging.service';
import { PackagingUsageEventsService } from './application/packaging-usage-event.service';
import { ProductAuditLogService } from './application/product-audit-log.service';
import { BulkMapPriceImportService } from './application/bulk-map-price-import.service';
import { PriceListService } from './application/price-list.service';
import { ProductCategoryService } from './application/product-category.service';
import { ErpCategoryImportService } from './application/erp-category-import.service';
import { ProductStructureService } from './application/product-structure.service';
import { ProductLotService } from './application/product-lot.service';
import { ProductsController } from './interface/controllers/products.controller';
import { SuppliersController } from './interface/controllers/suppliers.controller';
import { TaxProfilesController } from './interface/controllers/tax-profiles.controller';
import { CatalogSettingsController } from './interface/controllers/catalog-settings.controller';
import { PackagingController } from './interface/controllers/packaging.controller';
import { PackagingUsageEventController } from './interface/controllers/packaging-usage-event.controller';
import { PriceListsController } from './interface/controllers/price-lists.controller';
import { ProductCategoriesController } from './interface/controllers/product-categories.controller';
import { PrismaProductRepository } from './infrastructure/prisma-product.repository';
import { PrismaSupplierRepository } from './infrastructure/prisma-supplier.repository';
import { PrismaTaxProfileRepository } from './infrastructure/prisma-tax-profile.repository';
import { PrismaCatalogSettingsRepository } from './infrastructure/prisma-catalog-settings.repository';
import { PrismaPackagingRepository } from './infrastructure/prisma-packaging.repository';
import { PrismaPackagingUsageEventRepository } from './infrastructure/prisma-packaging-usage-event.repository';
import { PrismaProductAuditLogRepository } from './infrastructure/prisma-product-audit-log.repository';
import { PrismaPriceListRepository } from './infrastructure/prisma-price-list.repository';
import { PrismaPriceListExceptionRepository } from './infrastructure/prisma-price-list-exception.repository';
import { PrismaProductCategoryRepository } from './infrastructure/prisma-product-category.repository';
import { PrismaCategoryAttributeRepository } from './infrastructure/prisma-category-attribute.repository';
import { PrismaProductStructureRepository } from './infrastructure/prisma-product-structure.repository';
import { PrismaProductLotRepository } from './infrastructure/prisma-product-lot.repository';
import { PRODUCT_REPOSITORY } from './application/ports/product-repository.port';
import { SUPPLIER_REPOSITORY } from './application/ports/supplier-repository.port';
import { TAX_PROFILE_REPOSITORY } from './application/ports/tax-profile-repository.port';
import { CATALOG_SETTINGS_REPOSITORY } from './application/ports/catalog-settings-repository.port';
import { PACKAGING_REPOSITORY } from './application/ports/packaging-repository.port';
import { PACKAGING_USAGE_EVENT_REPOSITORY } from './application/ports/packaging-usage-event-repository.port';
import { PRODUCT_AUDIT_LOG_REPOSITORY } from './application/ports/product-audit-log-repository.port';
import { PRICE_LIST_REPOSITORY } from './application/ports/price-list-repository.port';
import { PRICE_LIST_EXCEPTION_REPOSITORY } from './application/ports/price-list-exception-repository.port';
import { PRODUCT_CATEGORY_REPOSITORY } from './application/ports/product-category-repository.port';
import { CATEGORY_ATTRIBUTE_REPOSITORY } from './application/ports/category-attribute-repository.port';
import { PRODUCT_STRUCTURE_REPOSITORY } from './application/ports/product-structure-repository.port';
import { PRODUCT_LOT_REPOSITORY } from './application/ports/product-lot-repository.port';
import { LogisticsIntelligenceModule } from '../logistics-intelligence/logistics-intelligence.module';
import {
  PRODUCT_CATALOG_WRITER,
  PRODUCT_CATALOG_READER,
  FINANCIAL_POLICY_READER,
  PACKAGING_LINKED_PRODUCTS_READER,
  PACKAGING_COST_READER,
} from '../../shared/contracts/tokens';
import { PRODUCT_CATEGORY_READER } from '../../shared/contracts/product-category-reader.port';
import { PRODUCT_STRUCTURE_READER } from '../../shared/contracts/product-structure-reader.port';
import { PRODUCT_LOT_READER } from '../../shared/contracts/product-lot-reader.port';

@Module({
  // Catalog consome a porta ShippingWeightCalculator exportada pelo Logistics
  // Intelligence — é o único acoplamento entre os dois, e é via interface.
  imports: [LogisticsIntelligenceModule],
  controllers: [
    ProductsController,
    SuppliersController,
    TaxProfilesController,
    CatalogSettingsController,
    PackagingController,
    PackagingUsageEventController,
    PriceListsController,
    ProductCategoriesController,
  ],
  providers: [
    ProductsService,
    SuppliersService,
    TaxProfilesService,
    CatalogSettingsService,
    CatalogSyncWriterService,
    CatalogReaderService,
    FinancialPolicyReaderService,
    PackagingsService,
    PackagingUsageEventsService,
    // Política de Preço Mínimo (MAP) — trilha de auditoria de campos de
    // governança do Product, consumida por ProductsService.update e pelo
    // import em massa (ver product-audit-log.service.ts).
    ProductAuditLogService,
    BulkMapPriceImportService,
    // Lista de Preços (Fase 2, benchmark Tiny ERP, seção 1.5).
    PriceListService,
    // Árvore de categoria + atributos por categoria (Fase 4, benchmark Tiny
    // ERP) — modelo espelha o Tiny/Olist: atributos na categoria (não no
    // produto), com herança opcional para categorias-filhas.
    ProductCategoryService,
    ErpCategoryImportService,
    // BOM real — Produtos-Estrutura (Projeto Estruturante 1, benchmark Bling
    // ERP, 29/07/2026) — cadastro de componentes de um produto kit.
    ProductStructureService,
    // Produtos-Lotes (Projeto Estruturante 2, benchmark Bling ERP,
    // 29/07/2026) — cadastro de lote/validade por SKU controlaLote=true.
    ProductLotService,
    { provide: PRODUCT_REPOSITORY, useClass: PrismaProductRepository },
    { provide: SUPPLIER_REPOSITORY, useClass: PrismaSupplierRepository },
    { provide: TAX_PROFILE_REPOSITORY, useClass: PrismaTaxProfileRepository },
    { provide: CATALOG_SETTINGS_REPOSITORY, useClass: PrismaCatalogSettingsRepository },
    { provide: PACKAGING_REPOSITORY, useClass: PrismaPackagingRepository },
    { provide: PACKAGING_USAGE_EVENT_REPOSITORY, useClass: PrismaPackagingUsageEventRepository },
    { provide: PRODUCT_AUDIT_LOG_REPOSITORY, useClass: PrismaProductAuditLogRepository },
    { provide: PRICE_LIST_REPOSITORY, useClass: PrismaPriceListRepository },
    { provide: PRICE_LIST_EXCEPTION_REPOSITORY, useClass: PrismaPriceListExceptionRepository },
    { provide: PRODUCT_CATEGORY_REPOSITORY, useClass: PrismaProductCategoryRepository },
    { provide: CATEGORY_ATTRIBUTE_REPOSITORY, useClass: PrismaCategoryAttributeRepository },
    { provide: PRODUCT_STRUCTURE_REPOSITORY, useClass: PrismaProductStructureRepository },
    { provide: PRODUCT_LOT_REPOSITORY, useClass: PrismaProductLotRepository },
    // Exporta a PORTA (token), nunca a classe concreta — o erp-integration só
    // vai conhecer PRODUCT_CATALOG_WRITER + a interface ProductCatalogWriter.
    { provide: PRODUCT_CATALOG_WRITER, useExisting: CatalogSyncWriterService },
    { provide: PRODUCT_CATALOG_READER, useExisting: CatalogReaderService },
    { provide: FINANCIAL_POLICY_READER, useExisting: FinancialPolicyReaderService },
    { provide: PACKAGING_LINKED_PRODUCTS_READER, useExisting: CatalogReaderService },
    // Sprint 26 — exporta a PORTA (token), nunca PackagingsService direto;
    // consumido pelo Logistics Fulfillment (LogisticsCostReaderService).
    { provide: PACKAGING_COST_READER, useExisting: PackagingsService },
    // Fase 4 (benchmark Tiny ERP) — consumido pelo futuro módulo
    // marketplace-publishing para resolver categoria + atributos efetivos
    // de um produto antes de publicar um anúncio.
    { provide: PRODUCT_CATEGORY_READER, useExisting: ProductCategoryService },
    // Projeto Estruturante 1 (benchmark Bling, 29/07/2026) — consumido pelo
    // módulo production (ProductionOrderService) para montar o snapshot de
    // componentes de uma ordem de produção.
    { provide: PRODUCT_STRUCTURE_READER, useExisting: ProductStructureService },
    // Projeto Estruturante 2 (benchmark Bling, 29/07/2026) — consumido pelo
    // módulo logistics-fulfillment (LotAvailabilityService +
    // StockMovementAuditEventService.adjustLot) para resolver metadado de
    // lote sem depender de PRODUCT_LOT_REPOSITORY nem da classe concreta.
    { provide: PRODUCT_LOT_READER, useExisting: ProductLotService },
  ],
  exports: [
    PRODUCT_CATALOG_WRITER,
    PRODUCT_CATALOG_READER,
    FINANCIAL_POLICY_READER,
    PACKAGING_LINKED_PRODUCTS_READER,
    PACKAGING_COST_READER,
    // Benchmark Tiny ERP (28/07/2026) — Contas a Pagar (financial-intelligence)
    // precisa validar que um supplierId informado pertence ao tenant antes de
    // gravar. Exporta a PORTA (token), nunca SuppliersService concreto —
    // mesmo padrão de todo o resto deste módulo.
    SUPPLIER_REPOSITORY,
    PRODUCT_CATEGORY_READER,
    PRODUCT_STRUCTURE_READER,
    PRODUCT_LOT_READER,
  ],
})
export class CatalogModule {}
