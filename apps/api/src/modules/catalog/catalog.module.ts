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
import { ProductsController } from './interface/controllers/products.controller';
import { SuppliersController } from './interface/controllers/suppliers.controller';
import { TaxProfilesController } from './interface/controllers/tax-profiles.controller';
import { CatalogSettingsController } from './interface/controllers/catalog-settings.controller';
import { PackagingController } from './interface/controllers/packaging.controller';
import { PackagingUsageEventController } from './interface/controllers/packaging-usage-event.controller';
import { PrismaProductRepository } from './infrastructure/prisma-product.repository';
import { PrismaSupplierRepository } from './infrastructure/prisma-supplier.repository';
import { PrismaTaxProfileRepository } from './infrastructure/prisma-tax-profile.repository';
import { PrismaCatalogSettingsRepository } from './infrastructure/prisma-catalog-settings.repository';
import { PrismaPackagingRepository } from './infrastructure/prisma-packaging.repository';
import { PrismaPackagingUsageEventRepository } from './infrastructure/prisma-packaging-usage-event.repository';
import { PrismaProductAuditLogRepository } from './infrastructure/prisma-product-audit-log.repository';
import { PRODUCT_REPOSITORY } from './application/ports/product-repository.port';
import { SUPPLIER_REPOSITORY } from './application/ports/supplier-repository.port';
import { TAX_PROFILE_REPOSITORY } from './application/ports/tax-profile-repository.port';
import { CATALOG_SETTINGS_REPOSITORY } from './application/ports/catalog-settings-repository.port';
import { PACKAGING_REPOSITORY } from './application/ports/packaging-repository.port';
import { PACKAGING_USAGE_EVENT_REPOSITORY } from './application/ports/packaging-usage-event-repository.port';
import { PRODUCT_AUDIT_LOG_REPOSITORY } from './application/ports/product-audit-log-repository.port';
import { LogisticsIntelligenceModule } from '../logistics-intelligence/logistics-intelligence.module';
import {
  PRODUCT_CATALOG_WRITER,
  PRODUCT_CATALOG_READER,
  FINANCIAL_POLICY_READER,
  PACKAGING_LINKED_PRODUCTS_READER,
  PACKAGING_COST_READER,
} from '../../shared/contracts/tokens';

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
    { provide: PRODUCT_REPOSITORY, useClass: PrismaProductRepository },
    { provide: SUPPLIER_REPOSITORY, useClass: PrismaSupplierRepository },
    { provide: TAX_PROFILE_REPOSITORY, useClass: PrismaTaxProfileRepository },
    { provide: CATALOG_SETTINGS_REPOSITORY, useClass: PrismaCatalogSettingsRepository },
    { provide: PACKAGING_REPOSITORY, useClass: PrismaPackagingRepository },
    { provide: PACKAGING_USAGE_EVENT_REPOSITORY, useClass: PrismaPackagingUsageEventRepository },
    { provide: PRODUCT_AUDIT_LOG_REPOSITORY, useClass: PrismaProductAuditLogRepository },
    // Exporta a PORTA (token), nunca a classe concreta — o erp-integration só
    // vai conhecer PRODUCT_CATALOG_WRITER + a interface ProductCatalogWriter.
    { provide: PRODUCT_CATALOG_WRITER, useExisting: CatalogSyncWriterService },
    { provide: PRODUCT_CATALOG_READER, useExisting: CatalogReaderService },
    { provide: FINANCIAL_POLICY_READER, useExisting: FinancialPolicyReaderService },
    { provide: PACKAGING_LINKED_PRODUCTS_READER, useExisting: CatalogReaderService },
    // Sprint 26 — exporta a PORTA (token), nunca PackagingsService direto;
    // consumido pelo Logistics Fulfillment (LogisticsCostReaderService).
    { provide: PACKAGING_COST_READER, useExisting: PackagingsService },
  ],
  exports: [
    PRODUCT_CATALOG_WRITER,
    PRODUCT_CATALOG_READER,
    FINANCIAL_POLICY_READER,
    PACKAGING_LINKED_PRODUCTS_READER,
    PACKAGING_COST_READER,
  ],
})
export class CatalogModule {}
