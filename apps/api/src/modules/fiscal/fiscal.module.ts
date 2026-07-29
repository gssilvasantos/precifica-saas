import { Module } from '@nestjs/common';
import { FiscalSettingsService } from './application/fiscal-settings.service';
import { FiscalInvoiceService } from './application/fiscal-invoice.service';
import { FiscalMarketplaceIntermediaryService } from './application/fiscal-marketplace-intermediary.service';
import { NaturezaOperacaoService } from './application/natureza-operacao.service';
import { OrderApprovedAutoEmitListener } from './application/order-approved-auto-emit.listener';
import { FocusNfeApiClient } from './infrastructure/focus-nfe-api.client';
import { PrismaFiscalSettingsRepository } from './infrastructure/prisma-fiscal-settings.repository';
import { PrismaFiscalInvoiceRepository } from './infrastructure/prisma-fiscal-invoice.repository';
import { PrismaFiscalMarketplaceIntermediaryRepository } from './infrastructure/prisma-fiscal-marketplace-intermediary.repository';
import { PrismaNaturezaOperacaoRepository } from './infrastructure/prisma-natureza-operacao.repository';
import { FiscalSettingsController } from './interface/controllers/fiscal-settings.controller';
import { FiscalInvoicesController } from './interface/controllers/fiscal-invoices.controller';
import { FocusNfeWebhookController } from './interface/controllers/focus-nfe-webhook.controller';
import { FiscalMarketplaceIntermediariesController } from './interface/controllers/fiscal-marketplace-intermediaries.controller';
import { NaturezasOperacaoController } from './interface/controllers/naturezas-operacao.controller';
import { FISCAL_SETTINGS_REPOSITORY } from './application/ports/fiscal-settings-repository.port';
import { FISCAL_INVOICE_REPOSITORY } from './application/ports/fiscal-invoice-repository.port';
import { FISCAL_MARKETPLACE_INTERMEDIARY_REPOSITORY } from './application/ports/fiscal-marketplace-intermediary-repository.port';
import { NATUREZA_OPERACAO_REPOSITORY } from './application/ports/natureza-operacao-repository.port';
import { OrdersModule } from '../orders/orders.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';
import { ObservabilityModule } from '../../shared/observability/observability.module';

// Emissão de NF-e (Fase 3, benchmark Tiny ERP, 28/07/2026) — ver
// docs/tiny-erp-benchmark-analysis.md, seção 1.1, e
// docs/fiscal-nfe-architecture.md. Bounded context PRÓPRIO (schema `fiscal`)
// que consome, via porta, o Orders (ORDER_FISCAL_READER, dados do pedido) e
// o Catalog (PRODUCT_CATALOG_READER, NCM/origem por SKU) — nunca importa a
// classe concreta de nenhum dos dois, mesma disciplina de Ports & Adapters
// do resto da plataforma.
@Module({
  imports: [
    OrdersModule, // só para consumir ORDER_FISCAL_READER (exportado de lá)
    CatalogModule, // só para consumir PRODUCT_CATALOG_READER (NCM/origem por SKU)
    ErpIntegrationModule, // só para consumir CredentialEncryptionService (token do Focus NFe em repouso)
    ObservabilityModule, // só para consumir ALERT_SERVICE (auto-emissão bloqueada por dados incompletos)
  ],
  controllers: [
    FiscalSettingsController,
    FiscalInvoicesController,
    FocusNfeWebhookController,
    FiscalMarketplaceIntermediariesController,
    NaturezasOperacaoController,
  ],
  providers: [
    FiscalSettingsService,
    FiscalInvoiceService,
    FiscalMarketplaceIntermediaryService,
    NaturezaOperacaoService,
    OrderApprovedAutoEmitListener,
    FocusNfeApiClient,
    { provide: FISCAL_SETTINGS_REPOSITORY, useClass: PrismaFiscalSettingsRepository },
    { provide: FISCAL_INVOICE_REPOSITORY, useClass: PrismaFiscalInvoiceRepository },
    { provide: FISCAL_MARKETPLACE_INTERMEDIARY_REPOSITORY, useClass: PrismaFiscalMarketplaceIntermediaryRepository },
    { provide: NATUREZA_OPERACAO_REPOSITORY, useClass: PrismaNaturezaOperacaoRepository },
  ],
})
export class FiscalModule {}
