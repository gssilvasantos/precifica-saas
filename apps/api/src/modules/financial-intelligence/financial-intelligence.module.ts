import { Module } from '@nestjs/common';
import { FixedExpensesService } from './application/fixed-expenses.service';
import { ReceivablesService } from './application/receivables.service';
import { ReceivableReconciliationService } from './application/receivable-reconciliation.service';
import { ReceivableFromOrderListener } from './application/receivable-from-order.listener';
import { FinancialOrchestrator } from './application/financial-orchestrator.service';
import { AccountsPayableService } from './application/accounts-payable.service';
import { SettlementParserRegistry, SETTLEMENT_REPORT_PARSERS } from './application/settlement-parser-registry.service';
import {
  PaymentReconciliationProviderRegistry,
  PAYMENT_RECONCILIATION_PROVIDERS,
} from './application/payment-reconciliation-provider-registry.service';
import { ChannelPaymentReconciliationOrchestrator } from './application/channel-payment-reconciliation-orchestrator.service';
import { PaymentWebhookListener } from './application/payment-webhook.listener';
import { PrismaFixedExpenseRepository } from './infrastructure/prisma-fixed-expense.repository';
import { PrismaReceivableRecordRepository } from './infrastructure/prisma-receivable-record.repository';
import { PrismaAccountsPayableRepository } from './infrastructure/prisma-accounts-payable.repository';
import { GenericSettlementParser } from './infrastructure/generic-settlement-parser';
import { FixedExpensesController } from './interface/controllers/fixed-expenses.controller';
import { ReceivablesController } from './interface/controllers/receivables.controller';
import { SettlementImportController } from './interface/controllers/settlement-import.controller';
import { DreController } from './interface/controllers/dre.controller';
import { AccountsPayableController } from './interface/controllers/accounts-payable.controller';
import { FIXED_EXPENSE_REPOSITORY } from './application/ports/fixed-expense-repository.port';
import { RECEIVABLE_RECORD_REPOSITORY } from './application/ports/receivable-record-repository.port';
import { ACCOUNTS_PAYABLE_REPOSITORY } from './application/ports/accounts-payable-repository.port';
import { ACCOUNTS_PAYABLE_WRITER } from '../../shared/contracts/accounts-payable-writer.port';
import { DreTaxEstimator } from './application/dre-tax-estimator.service';
import { TaxIntelligenceModule } from '../tax-intelligence/public-api';
import { OrdersModule } from '../orders/orders.module';
import { CatalogModule } from '../catalog/catalog.module';
import { MarketplaceAdsModule } from '../marketplace-ads/marketplace-ads.module';
import { MarketplaceIntelligenceModule } from '../marketplace-intelligence/marketplace-intelligence.module';
import { MercadoLivreChannelPaymentProvider } from '../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-channel-payment.provider';
import { ObservabilityModule } from '../../shared/observability/observability.module';

// Bounded context próprio (DRE + Contas a Receber) — ver
// docs/financial-intelligence-architecture.md. A reconciliação lê só as
// próprias tabelas; a reprecificação reativa a mudança de custo de
// embalagem mora no Pricing Intelligence (PackagingCostChangeListener), não
// aqui. ReceivableFromOrderListener é uma exceção PARCIAL histórica: assina
// ORDER_EVENTS (Orders) via EventEmitter2, o que nunca exigiu importar
// OrdersModule — só o arquivo de constantes/tipos orders/domain/order-events.ts
// (mesmo padrão de CompetitorSignalListener/PackagingCostChangeListener).
//
// FinancialOrchestrator (Etapa 20) é a PRIMEIRA exceção de import de módulo
// de verdade: importa OrdersModule só para consumir ORDER_FINANCIALS_READER
// (porta, ver shared/contracts/order-financials-reader.port.ts) — nunca a
// classe concreta OrdersService. Mesmo padrão de Ports & Adapters que
// OrdersModule já usa para consumir PRODUCT_CATALOG_READER do CatalogModule;
// a diferença de ReceivableFromOrderListener é que ali a necessidade é
// REAGIR a um evento (zero import de módulo), enquanto o DRE precisa
// CONSULTAR dados consolidados sob demanda — um import de módulo pela porta
// certa é a forma correta de resolver isso, não uma exceção à disciplina.
//
// Importa CatalogModule (Contas a Pagar, 28/07/2026) só para consumir
// SUPPLIER_REPOSITORY — AccountsPayableService.create valida que o
// supplierId informado pertence ao tenant antes de gravar, mesmo racional de
// FinancialOrchestrator consumindo ORDER_FINANCIALS_READER do OrdersModule.
@Module({
  // MarketplaceAdsModule entrou em 01/08/2026 só para consumir
  // ADS_SPEND_READER (linha de publicidade do DRE). Sem ciclo: o módulo de
  // Ads não importa este de volta.
  // TaxIntelligenceModule (Slice A, 10/2026): TAX_RATE_RESOLVER para o imposto
  // do DRE. Sem ciclo: Tax importa Orders, não Financial.
  // MarketplaceIntelligenceModule (13/10/2026, conciliação por canal) — só
  // para consumir MercadoLivreChannelPaymentProvider (exportado de lá),
  // registrado abaixo em PAYMENT_RECONCILIATION_PROVIDERS. Mesmo racional de
  // OrdersModule importando MarketplaceIntelligenceModule para
  // MercadoLivreOrderProvider — sem ciclo: MarketplaceIntelligenceModule não
  // importa este módulo de volta.
  // ObservabilityModule — só para consumir ALERT_SERVICE
  // (ChannelPaymentReconciliationOrchestrator avisa se a conciliação de um
  // tenant falhar).
  imports: [OrdersModule, CatalogModule, MarketplaceAdsModule, TaxIntelligenceModule, MarketplaceIntelligenceModule, ObservabilityModule],
  controllers: [
    FixedExpensesController,
    ReceivablesController,
    SettlementImportController,
    DreController,
    AccountsPayableController,
  ],
  providers: [
    FixedExpensesService,
    ReceivablesService,
    ReceivableReconciliationService,
    ReceivableFromOrderListener,
    FinancialOrchestrator,
    DreTaxEstimator,
    AccountsPayableService,
    SettlementParserRegistry,
    // Conciliação por canal (13/10/2026) — fecha o gap documentado no
    // comentário de SettlementImportController ("um futuro job/webhook por
    // canal chamaria ReceivableReconciliationService no mesmo lugar").
    // PaymentReconciliationProviderRegistry + ChannelPaymentReconciliationOrchestrator
    // seguem o MESMO padrão Fetch->Reconcile de OrderProviderRegistry/
    // OrderSyncOrchestrator; PaymentWebhookListener é quem os dispara, a
    // partir do evento emitido por WebhooksController (topic "payments").
    PaymentReconciliationProviderRegistry,
    ChannelPaymentReconciliationOrchestrator,
    PaymentWebhookListener,
    { provide: FIXED_EXPENSE_REPOSITORY, useClass: PrismaFixedExpenseRepository },
    { provide: RECEIVABLE_RECORD_REPOSITORY, useClass: PrismaReceivableRecordRepository },
    { provide: ACCOUNTS_PAYABLE_REPOSITORY, useClass: PrismaAccountsPayableRepository },
    // Registry multi-provider (mesmo padrão de MARKETPLACE_PROVIDERS/
    // COMPETITION_RADARS) — hoje só o parser de referência, registrado para
    // NUVEMSHOP (o único canal com integração real hoje). Adicionar um
    // marketplace novo é acrescentar mais uma entrada nesta lista, nunca
    // alterar SettlementParserRegistry/ReceivableReconciliationService.
    {
      provide: SETTLEMENT_REPORT_PARSERS,
      useFactory: () => [new GenericSettlementParser('NUVEMSHOP')],
    },
    // Registro central de providers de conciliação de pagamento — adicionar
    // um canal novo (Shopee...) é acrescentar mais uma entrada aqui, nunca
    // alterar PaymentReconciliationProviderRegistry/
    // ChannelPaymentReconciliationOrchestrator.
    {
      provide: PAYMENT_RECONCILIATION_PROVIDERS,
      useFactory: (ml: MercadoLivreChannelPaymentProvider) => [ml],
      inject: [MercadoLivreChannelPaymentProvider],
    },
    // Ordem de Compra (Fase 1) — AccountsPayableService implementa
    // AccountsPayableWriter (createSingle); exporta a PORTA, nunca a classe
    // concreta, mesmo padrão de LOGISTICS_COST_READER/STOCK_RECEIPT_WRITER em
    // LogisticsFulfillmentModule.
    { provide: ACCOUNTS_PAYABLE_WRITER, useExisting: AccountsPayableService },
  ],
  exports: [
    // Ordem de Compra (Fase 1) — PurchaseOrderService lança a conta a pagar
    // do fornecedor ao confirmar recebimento via esta porta.
    ACCOUNTS_PAYABLE_WRITER,
  ],
})
export class FinancialIntelligenceModule {}
