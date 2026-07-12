import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettlementParserRegistry } from './settlement-parser-registry.service';
import {
  RECEIVABLE_RECORD_REPOSITORY,
  ReceivableRecordRepository,
} from './ports/receivable-record-repository.port';
import { SettlementFileFormat } from '../../../shared/contracts/settlement-report-parser.contract';
import { FINANCIAL_EVENTS } from '../domain/financial-events';

// Resultado de negócio, não exceção — mesma filosofia do PriceUpdateDispatcher
// (Etapa 8): um arquivo de repasse com linhas que não casam com nenhum
// ReceivableRecord não é uma falha do sistema (pode ser um pedido criado
// fora do fluxo, ou um repasse duplicado já processado); o chamador decide o
// que fazer com `unmatchedReferences`.
export interface ReconciliationResult {
  matched: number;
  alreadyReconciled: number;
  unmatchedReferences: string[];
}

// Único ponto que marca um ReceivableRecord como PAID — casa cada
// RawSettlementEntry (já normalizado pelo SettlementReportParser certo,
// resolvido via SettlementParserRegistry) contra a tabela ReceivableRecord
// pela chave (tenantId, marketplaceSource, externalReference), a mesma
// desenhada no índice @@index([tenantId, marketplaceSource, externalReference]).
@Injectable()
export class ReceivableReconciliationService {
  private readonly logger = new Logger(ReceivableReconciliationService.name);

  constructor(
    private readonly parsers: SettlementParserRegistry,
    @Inject(RECEIVABLE_RECORD_REPOSITORY) private readonly receivables: ReceivableRecordRepository,
    private readonly events: EventEmitter2,
  ) {}

  async reconcile(
    tenantId: string,
    marketplaceCode: string,
    fileContent: string,
    format: SettlementFileFormat,
  ): Promise<ReconciliationResult> {
    const parser = this.parsers.findByMarketplaceCode(marketplaceCode);
    if (!parser) {
      this.logger.warn(`Nenhum SettlementReportParser registrado para ${marketplaceCode} — nada reconciliado.`);
      return { matched: 0, alreadyReconciled: 0, unmatchedReferences: [] };
    }

    const entries = parser.parse(fileContent, format);
    let matched = 0;
    let alreadyReconciled = 0;
    const unmatchedReferences: string[] = [];

    for (const entry of entries) {
      const receivable = await this.receivables.findByExternalReference(
        tenantId,
        marketplaceCode,
        entry.externalReference,
      );

      if (!receivable) {
        unmatchedReferences.push(entry.externalReference);
        continue;
      }

      // Idempotente: reimportar o mesmo arquivo (ou um arquivo sobreposto)
      // não reprocessa nem reemite o evento para um repasse já reconciliado.
      if (receivable.status === 'PAID') {
        alreadyReconciled++;
        continue;
      }

      await this.receivables.markPaid(receivable.id, { status: 'PAID', paidAt: entry.settledAt });
      this.events.emit(FINANCIAL_EVENTS.RECEIVABLE_PAID, {
        tenantId,
        receivableId: receivable.id,
        amount: entry.amount,
        marketplaceSource: marketplaceCode,
        paidAt: entry.settledAt,
      });
      matched++;
    }

    this.logger.log(
      `Reconciliação ${marketplaceCode} (tenant ${tenantId}): ${matched} casados, ${alreadyReconciled} já reconciliados antes, ${unmatchedReferences.length} sem match.`,
    );

    return { matched, alreadyReconciled, unmatchedReferences };
  }
}
