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
import {
  StockMovementAuditEvent,
  StockMovementAuditEventCreateData,
  StockMovementAuditEventItem,
  StockMovementLine,
  canApprove,
  canMarkDivergent,
  canScanItem,
  buildChecklistFromOrderItems,
  buildLedgerEntries,
} from '../domain/stock-movement-audit-event.entity';

// O "gate" pedido pelo usuário, em forma de serviço: cria o evento como
// PENDENTE (fase 1, sem nenhum movimento de estoque), aceita mídia, e só
// grava StockLedgerEntry dentro de approve() — o ÚNICO método deste
// serviço (e de toda a plataforma) que constrói linhas de ledger. Ver
// docs/logistics-fulfillment-architecture.md para o racional completo do
// Hub de Provas e docs/pick-pack-architecture.md (Sprint 27) para o
// checklist de bipagem/vídeo em chunks adicionados aqui.
@Injectable()
export class StockMovementAuditEventService {
  private readonly logger = new Logger(StockMovementAuditEventService.name);

  constructor(
    @Inject(STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY) private readonly events: StockMovementAuditEventRepository,
    @Inject(STOCK_MOVEMENT_AUDIT_EVENT_ITEM_REPOSITORY) private readonly checklistItems: StockMovementAuditEventItemRepository,
    @Inject(ORDER_FINANCIALS_READER) private readonly orderItemsReader: OrderFinancialsReader,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
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

  private async requireEvent(tenantId: string, eventId: string): Promise<StockMovementAuditEvent> {
    const event = await this.events.findById(tenantId, eventId);
    if (!event) throw new NotFoundException(`Evento de auditoria ${eventId} não encontrado.`);
    return event;
  }
}
