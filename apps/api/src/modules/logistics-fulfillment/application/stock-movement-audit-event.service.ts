import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY,
  StockMovementAuditEventRepository,
} from './ports/stock-movement-audit-event-repository.port';
import {
  STOCK_MOVEMENT_AUDIT_EVENT_ITEM_REPOSITORY,
  StockMovementAuditEventItemRepository,
} from './ports/stock-movement-audit-event-item-repository.port';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';
import { ORDER_FINANCIALS_READER } from '../../../shared/contracts/tokens';
import { OrderFinancialsReader } from '../../../shared/contracts/order-financials-reader.port';
import { StockReceiptLine, StockReceiptWriter } from '../../../shared/contracts/stock-receipt-writer.port';
import { ProductionStockLine, ProductionStockWriter } from '../../../shared/contracts/production-stock-writer.port';
import { PRODUCT_LOT_READER, ProductLotReader } from '../../../shared/contracts/product-lot-reader.port';
import { STOCK_LEDGER_REPOSITORY, StockLedgerRepository } from './ports/stock-ledger-repository.port';
import {
  StockMovementAuditEvent,
  StockMovementAuditEventCreateData,
  StockMovementAuditEventItem,
  StockMovementLine,
  LotAdjustmentMovementType,
  canApprove,
  canMarkDivergent,
  canScanItem,
  canApprovePurchaseReceipt,
  canApproveProduction,
  canApproveLotAdjustment,
  buildChecklistFromOrderItems,
  buildLedgerEntries,
  buildPurchaseReceiptLedgerEntries,
  buildProductionLedgerEntries,
  resolveLotAdjustmentDelta,
  buildLotAdjustmentLedgerEntry,
} from '../domain/stock-movement-audit-event.entity';

// O "gate" pedido pelo usuário, em forma de serviço: cria o evento como
// PENDENTE (fase 1, sem nenhum movimento de estoque), aceita mídia, e só
// grava StockLedgerEntry dentro de approve()/receivePurchase() — os ÚNICOS
// métodos deste serviço (e de toda a plataforma) que constroem linhas de
// ledger. Ver docs/logistics-fulfillment-architecture.md para o racional
// completo do Hub de Provas e docs/pick-pack-architecture.md (Sprint 27)
// para o checklist de bipagem/vídeo em chunks adicionados aqui. Implementa
// StockReceiptWriter (shared/contracts) — porta consumida pelo Procurement
// (Ordem de Compra, Fase 1) para dar entrada de mercadoria comprada.
// Implementa também ProductionStockWriter (shared/contracts) — porta
// consumida pelo production (Ordem de Produção, Projeto Estruturante 1) ao
// concluir uma ordem.
@Injectable()
export class StockMovementAuditEventService implements StockReceiptWriter, ProductionStockWriter {
  private readonly logger = new Logger(StockMovementAuditEventService.name);

  constructor(
    @Inject(STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY) private readonly events: StockMovementAuditEventRepository,
    @Inject(STOCK_MOVEMENT_AUDIT_EVENT_ITEM_REPOSITORY) private readonly checklistItems: StockMovementAuditEventItemRepository,
    @Inject(ORDER_FINANCIALS_READER) private readonly orderItemsReader: OrderFinancialsReader,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
    // Produtos-Lotes (Projeto Estruturante 2) — usadas só por adjustLot:
    // STOCK_LEDGER_REPOSITORY para resolver o saldo atual num BALANCO,
    // PRODUCT_LOT_READER (Catalog) para validar que o lotCode informado de
    // fato existe para este SKU/tenant antes de gravar.
    @Inject(STOCK_LEDGER_REPOSITORY) private readonly ledger: StockLedgerRepository,
    @Inject(PRODUCT_LOT_READER) private readonly lotReader: ProductLotReader,
  ) {}

  // Fase 1 — nenhum estoque se move aqui. Chamado tanto pelo listener de
  // ORDER_EVENTS.READY_FOR_FULFILLMENT (RETAIL_SHIPMENT, 1 pedido) quanto
  // pelo endpoint de montagem de lote Full (FULL_DISPATCH, N pedidos ou
  // nenhum, no caso de reabastecimento preventivo).
  //
  // Sprint 27 — monta o checklist de bipagem a partir dos itens dos
  // pedidos vinculados, agregado por SKU (buildChecklistFromOrderItems).
  // orderIds vazio (reabastecimento preventivo) resulta em checklist vazio
  // de propósito — é o que preserva o fluxo legado de aprovação só por
  // mídia (ver isFullyScanned no domínio).
  async createPending(data: StockMovementAuditEventCreateData): Promise<StockMovementAuditEvent> {
    const event = await this.events.create(data);

    if (data.orderIds && data.orderIds.length > 0) {
      const orderItems = await this.orderItemsReader.findItemsForOrders(data.tenantId, data.orderIds);
      const unresolvedCount = orderItems.filter((item) => !item.skuCode).length;
      if (unresolvedCount > 0) {
        // Gap conhecido (ver domain/stock-movement-audit-event.entity.ts,
        // buildChecklistFromOrderItems): item sem SKU resolvido não entra
        // no checklist — reportado aqui, nunca descartado em silêncio.
        this.logger.warn(
          `Evento ${event.id} (tenant ${data.tenantId}): ${unresolvedCount} item(ns) de pedido sem SKU resolvido — ficaram FORA do checklist de bipagem.`,
        );
      }

      const checklist = buildChecklistFromOrderItems(orderItems);
      if (checklist.length > 0) {
        await this.checklistItems.createMany(
          checklist.map((line) => ({
            tenantId: data.tenantId,
            auditEventId: event.id,
            skuCode: line.skuCode,
            expectedQuantity: line.expectedQuantity,
          })),
        );
      }
    }

    return event;
  }

  // Anexar mídia NÃO aprova o evento sozinho — é só um dos pré-requisitos
  // que canApprove exige (o outro, desde a Sprint 27, é o checklist 100%
  // bipado). Continua PENDENTE até alguém chamar approve() ou
  // markDivergent() explicitamente.
  async attachMedia(tenantId: string, eventId: string, mediaUrl: string, mediaType: string): Promise<StockMovementAuditEvent> {
    const event = await this.requireEvent(tenantId, eventId);
    if (event.conferenceStatus !== 'PENDENTE') {
      throw new BadRequestException(`Evento já está ${event.conferenceStatus} — não é possível trocar a mídia.`);
    }
    return this.events.attachMedia(eventId, mediaUrl, mediaType);
  }

  // Sprint 27 — "bipar" um item do checklist (leitura de código de barras,
  // ou digitação manual do SKU na tela de conferência). Nunca aceita um
  // valor absoluto de quantidade do chamador — sempre +1, e sempre validado
  // por canScanItem ANTES de tocar o repositório (nunca deixa passar de
  // expectedQuantity).
  async scanItem(tenantId: string, eventId: string, skuCode: string): Promise<StockMovementAuditEventItem> {
    const event = await this.requireEvent(tenantId, eventId);
    if (event.conferenceStatus !== 'PENDENTE') {
      throw new BadRequestException(`Evento já está ${event.conferenceStatus} — não é possível bipar itens.`);
    }

    const item = await this.checklistItems.findOneBySku(tenantId, eventId, skuCode);
    const check = canScanItem(item ?? undefined, skuCode);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    return this.checklistItems.incrementScanned(item!.id);
  }

  getChecklist(tenantId: string, eventId: string): Promise<StockMovementAuditEventItem[]> {
    return this.checklistItems.findByAuditEvent(tenantId, eventId);
  }

  // Sprint 27 — fila de trabalho da tela de conferência (ver comentário do
  // port). Sem paginação por ora: volume de eventos PENDENTES simultâneos é
  // naturalmente pequeno (só existem enquanto ninguém confere o despacho).
  getPendingQueue(tenantId: string): Promise<StockMovementAuditEvent[]> {
    return this.events.findPending(tenantId);
  }

  // Fase 2 (aprovação) — só chega a gravar StockLedgerEntry se canApprove
  // devolver ok: mídia anexada E (Sprint 27) checklist 100% bipado. `lines`
  // é a quantidade por SKU deste despacho, informada pelo conferente no
  // momento da aprovação (não no momento da criação), porque é só na
  // conferência física que a quantidade real é confirmada.
  async approve(
    tenantId: string,
    eventId: string,
    conferredByUserId: string,
    lines: StockMovementLine[],
  ): Promise<StockMovementAuditEvent> {
    const event = await this.requireEvent(tenantId, eventId);
    const items = await this.checklistItems.findByAuditEvent(tenantId, eventId);

    const check = canApprove(event, items);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }
    if (lines.length === 0) {
      throw new BadRequestException('Informe ao menos um SKU/quantidade conferido para aprovar o evento.');
    }

    const ledgerEntries = buildLedgerEntries(event, lines);
    return this.events.approveWithLedger(eventId, conferredByUserId, ledgerEntries);
  }

  // Divergência NUNCA grava ledger — o estoque permanece intacto até
  // alguém corrigir manualmente (reconferir, ajustar quantidade, etc.).
  // Sempre emite um alerta técnico: uma divergência de conferência não pode
  // depender de alguém abrir a tela para notar.
  async markDivergent(
    tenantId: string,
    eventId: string,
    conferredByUserId: string,
    divergenceNotes: string,
  ): Promise<StockMovementAuditEvent> {
    const event = await this.requireEvent(tenantId, eventId);

    const check = canMarkDivergent(event);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    const updated = await this.events.markDivergent(eventId, conferredByUserId, divergenceNotes);

    this.alerts.emitAlert({
      source: 'StockMovementAuditEvent',
      severity: 'ERROR',
      message: `Divergência na conferência de estoque (evento ${eventId})`,
      context: { tenantId, eventId, eventType: event.eventType, divergenceNotes },
    });

    return updated;
  }

  getById(tenantId: string, eventId: string): Promise<StockMovementAuditEvent | null> {
    return this.events.findById(tenantId, eventId);
  }

  // Ordem de Compra (Fase 1) — dá entrada de mercadoria comprada. Diferente
  // de approve() (Fase 1 cria PENDENTE, Fase 2 aprova depois, separadas no
  // tempo pela conferência física do despacho), aqui cria+aprova no MESMO
  // método: a "conferência" de uma entrada é o ato de receber a mercadoria
  // do fornecedor com a NF em mãos, não um processo assíncrono de bipagem +
  // vídeo. Ver canApprovePurchaseReceipt/buildPurchaseReceiptLedgerEntries.
  async receivePurchase(
    tenantId: string,
    warehouseId: string,
    invoiceNumber: string,
    conferredByUserId: string,
    lines: StockReceiptLine[],
  ): Promise<{ auditEventId: string }> {
    if (lines.length === 0) {
      throw new BadRequestException('Informe ao menos um SKU/quantidade recebido para dar entrada.');
    }

    const event = await this.events.create({
      tenantId,
      eventType: 'PURCHASE_RECEIPT',
      sourceWarehouseId: warehouseId,
      invoiceNumber,
    });

    const check = canApprovePurchaseReceipt(event);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    const ledgerEntries = buildPurchaseReceiptLedgerEntries(event, lines as StockMovementLine[]);
    const approved = await this.events.approveWithLedger(event.id, conferredByUserId, ledgerEntries);
    return { auditEventId: approved.id };
  }

  // Ordem de Produção (Projeto Estruturante 1, benchmark Bling ERP,
  // 29/07/2026) — conclui uma ordem: debita os componentes na origem E
  // credita o produto acabado no destino, cria+aprova no MESMO método
  // (mesmo racional de receivePurchase: a "conferência" aqui é o próprio ato
  // de concluir a ordem, já com os componentes reservados via snapshot da
  // BOM, não um processo assíncrono de bipagem/mídia). Ver
  // canApproveProduction/buildProductionLedgerEntries.
  async produceOutput(
    tenantId: string,
    sourceWarehouseId: string,
    destinationWarehouseId: string,
    conferredByUserId: string,
    componentLines: ProductionStockLine[],
    outputLine: ProductionStockLine,
  ): Promise<{ auditEventId: string }> {
    if (componentLines.length === 0) {
      throw new BadRequestException('Informe ao menos um componente consumido para concluir a produção.');
    }

    const event = await this.events.create({
      tenantId,
      eventType: 'PRODUCTION_OUTPUT',
      sourceWarehouseId,
      destinationWarehouseId,
    });

    const check = canApproveProduction(event);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    const ledgerEntries = buildProductionLedgerEntries(
      { ...event, destinationWarehouseId },
      componentLines as StockMovementLine[],
      outputLine as StockMovementLine,
    );
    const approved = await this.events.approveWithLedger(event.id, conferredByUserId, ledgerEntries);
    return { auditEventId: approved.id };
  }

  // Produtos-Lotes (Projeto Estruturante 2, benchmark Bling ERP,
  // 29/07/2026) — lançamento manual avulso por lote (Entrada/Saída/
  // Balanço, espelha LoteLancamentoDTO do Bling). Cria+aprova no MESMO
  // método (mesmo racional de receivePurchase/produceOutput: a "prova" é a
  // justificativa textual já informada, não um processo assíncrono de
  // bipagem/mídia). Valida que o lotCode informado de fato existe para este
  // SKU/tenant (via PRODUCT_LOT_READER) ANTES de gravar — nunca cria lote
  // "no ato" a partir de um lançamento, cadastro de lote é sempre um passo
  // prévio explícito (ProductLotService.create).
  async adjustLot(
    tenantId: string,
    warehouseId: string,
    skuCode: string,
    lotCode: string,
    movementType: LotAdjustmentMovementType,
    quantity: number,
    conferredByUserId: string,
    notes: string,
  ): Promise<{ auditEventId: string }> {
    const lot = await this.lotReader.findLot(tenantId, skuCode, lotCode);
    if (!lot) {
      throw new BadRequestException(`Lote "${lotCode}" não encontrado para o SKU ${skuCode} — cadastre o lote antes de lançar.`);
    }

    const event = await this.events.create({
      tenantId,
      eventType: 'LOT_ADJUSTMENT',
      sourceWarehouseId: warehouseId,
      notes,
    });

    const check = canApproveLotAdjustment(event);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    // O saldo relevante para BALANCO é o do LOTE, não do SKU inteiro
    // (getBalance somaria outros lotes do mesmo SKU no mesmo depósito) —
    // por isso listBalancesByLot + find, nunca getBalance aqui.
    const lotBalances = await this.ledger.listBalancesByLot(tenantId, warehouseId, skuCode);
    const currentBalance = lotBalances.find((b) => b.lotCode === lotCode)?.balance ?? 0;
    const quantityDelta = resolveLotAdjustmentDelta({ movementType, quantity }, currentBalance);
    const ledgerEntry = buildLotAdjustmentLedgerEntry(event, { skuCode, lotCode, quantityDelta });

    const approved = await this.events.approveWithLedger(event.id, conferredByUserId, [ledgerEntry]);
    return { auditEventId: approved.id };
  }

  private async requireEvent(tenantId: string, eventId: string): Promise<StockMovementAuditEvent> {
    const event = await this.events.findById(tenantId, eventId);
    if (!event) throw new NotFoundException(`Evento de auditoria ${eventId} não encontrado.`);
    return event;
  }
}
