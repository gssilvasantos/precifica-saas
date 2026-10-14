import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettlementParserRegistry } from './settlement-parser-registry.service';
import {
  RECEIVABLE_RECORD_REPOSITORY,
  ReceivableRecordRepository,
} from './ports/receivable-record-repository.port';
import { RawSettlementEntry, SettlementFileFormat } from '../../../shared/contracts/settlement-report-parser.contract';
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
// RawSettlementEntry contra a tabela ReceivableRecord pela chave
// (tenantId, marketplaceSource, externalReference), a mesma desenhada no
// índice @@index([tenantId, marketplaceSource, externalReference]).
//
// Dois CAMINHOS alimentam RawSettlementEntry[], mesma lógica de match para
// os dois (applyEntries, abaixo) — nunca duplicada:
// 1. `reconcile()` — upload manual de arquivo (CSV/JSON), via
//    SettlementReportParser resolvido por SettlementParserRegistry. Único
//    caminho até 13/10/2026.
// 2. `reconcileEntries()` — dado já estruturado, vindo de uma chamada
//    autenticada à API do canal (ver PaymentReconciliationCapableProvider,
//    shared/contracts/marketplace-provider.contract.ts, e
//    ChannelPaymentReconciliationOrchestrator). Adicionado para fechar o
//    gap documentado no comentário de SettlementImportController: "um
//    futuro job/webhook por canal chamaria ReceivableReconciliationService
//    no mesmo lugar" — este é esse lugar.
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
    const result = await this.applyEntries(tenantId, marketplaceCode, entries);
    this.logger.log(
      `Reconciliação (arquivo) ${marketplaceCode} (tenant ${tenantId}): ${result.matched} casados, ${result.alreadyReconciled} já reconciliados antes, ${result.unmatchedReferences.length} sem match.`,
    );
    return result;
  }

  // Caminho webhook/API (13/10/2026) — entries já vêm normalizadas pelo
  // PROVIDER do canal (ex.: MercadoLivreChannelPaymentProvider), nunca de um
  // parser de arquivo. Mesma idempotência/mesmo evento de `reconcile()`.
  async reconcileEntries(
    tenantId: string,
    marketplaceCode: string,
    entries: RawSettlementEntry[],
  ): Promise<ReconciliationResult> {
    const result = await this.applyEntries(tenantId, marketplaceCode, entries);
    this.logger.log(
      `Reconciliação (API) ${marketplaceCode} (tenant ${tenantId}): ${result.matched} casados, ${result.alreadyReconciled} já reconciliados antes, ${result.unmatchedReferences.length} sem match.`,
    );
    return result;
  }

  private async applyEntries(
    tenantId: string,
    marketplaceCode: string,
    entries: RawSettlementEntry[],
  ): Promise<ReconciliationResult> {
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

      // Idempotente: reimportar o mesmo arquivo/reexecutar a mesma consulta
      // de API (ou uma janela sobreposta) não reprocessa nem reemite o
      // evento para um repasse já reconciliado.
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

    return { matched, alreadyReconciled, unmatchedReferences };
  }
}
