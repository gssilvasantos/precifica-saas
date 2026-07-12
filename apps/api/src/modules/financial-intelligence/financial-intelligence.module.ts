import { Module } from '@nestjs/common';
import { FixedExpensesService } from './application/fixed-expenses.service';
import { ReceivablesService } from './application/receivables.service';
import { ReceivableReconciliationService } from './application/receivable-reconciliation.service';
import { ReceivableFromOrderListener } from './application/receivable-from-order.listener';
import { FinancialOrchestrator } from './application/financial-orchestrator.service';
import { SettlementParserRegistry, SETTLEMENT_REPORT_PARSERS } from './application/settlement-parser-registry.service';
import { PrismaFixedExpenseRepository } from './infrastructure/prisma-fixed-expense.repository';
import { PrismaReceivableRecordRepository } from './infrastructure/prisma-receivable-record.repository';
import { GenericSettlementParser } from './infrastructure/generic-settlement-parser';
import { FixedExpensesController } from './interface/controllers/fixed-expenses.controller';
import { ReceivablesController } from './interface/controllers/receivables.controller';
import { SettlementImportController } from './interface/controllers/settlement-import.controller';
import { DreController } from './interface/controllers/dre.controller';
import { FIXED_EXPENSE_REPOSITORY } from './application/ports/fixed-expense-repository.port';
import { RECEIVABLE_RECORD_REPOSITORY } from './application/ports/receivable-record-repository.port';
import { OrdersModule } from '../orders/orders.module';

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
@Module({
  imports: [OrdersModule],
  controllers: [FixedExpensesController, ReceivablesController, SettlementImportController, DreController],
  providers: [
    FixedExpensesService,
    ReceivablesService,
    ReceivableReconciliationService,
    ReceivableFromOrderListener,
    FinancialOrchestrator,
    SettlementParserRegistry,
    { provide: FIXED_EXPENSE_REPOSITORY, useClass: PrismaFixedExpenseRepository },
    { provide: RECEIVABLE_RECORD_REPOSITORY, useClass: PrismaReceivableRecordRepository },
    // Registry multi-provider (mesmo padrão de MARKETPLACE_PROVIDERS/
    // COMPETITION_RADARS) — hoje só o parser de referência, registrado para
    // NUVEMSHOP (o único canal com integração real hoje). Adicionar um
    // marketplace novo é acrescentar mais uma entrada nesta lista, nunca
    // alterar SettlementParserRegistry/ReceivableReconciliationService.
    {
      provide: SETTLEMENT_REPORT_PARSERS,
      useFactory: () => [new GenericSettlementParser('NUVEMSHOP')],
    },
  ],
})
export class FinancialIntelligenceModule {}
