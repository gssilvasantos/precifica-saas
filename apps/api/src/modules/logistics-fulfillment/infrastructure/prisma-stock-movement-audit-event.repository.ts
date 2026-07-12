import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  LedgerEntryInput,
  StockMovementAuditEventRepository,
} from '../application/ports/stock-movement-audit-event-repository.port';
import {
  ConferenceStatus,
  StockMovementAuditEvent,
  StockMovementAuditEventCreateData,
  StockMovementEventType,
} from '../domain/stock-movement-audit-event.entity';

type RawEvent = {
  id: string;
  tenantId: string;
  eventType: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  conferenceStatus: string;
  conferredByUserId: string | null;
  conferredAt: Date | null;
  divergenceNotes: string | null;
  invoiceNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
  orders: Array<{ orderId: string }>;
};

@Injectable()
export class PrismaStockMovementAuditEventRepository implements StockMovementAuditEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: StockMovementAuditEventCreateData): Promise<StockMovementAuditEvent> {
    const orderIds = data.orderIds ?? [];
    const record = await this.prisma.stockMovementAuditEvent.create({
      data: {
        tenantId: data.tenantId,
        eventType: data.eventType,
        sourceWarehouseId: data.sourceWarehouseId,
        destinationWarehouseId: data.destinationWarehouseId ?? null,
        invoiceNumber: data.invoiceNumber ?? null,
        // Join N:N criado junto, na mesma escrita — nunca em dois passos
        // separados (evitaria uma janela onde o evento existe sem vínculo
        // nenhum a pedido, no caso comum de RETAIL_SHIPMENT).
        orders: orderIds.length > 0 ? { create: orderIds.map((orderId) => ({ orderId })) } : undefined,
      },
      include: { orders: true },
    });
    return this.toDomain(record as RawEvent);
  }

  async findById(tenantId: string, id: string): Promise<StockMovementAuditEvent | null> {
    const record = await this.prisma.stockMovementAuditEvent.findFirst({
      where: { id, tenantId },
      include: { orders: true },
    });
    return record ? this.toDomain(record as RawEvent) : null;
  }

  async findByOrderId(
    tenantId: string,
    orderId: string,
    eventType: StockMovementEventType,
  ): Promise<StockMovementAuditEvent | null> {
    const record = await this.prisma.stockMovementAuditEvent.findFirst({
      where: { tenantId, eventType, orders: { some: { orderId } } },
      include: { orders: true },
    });
    return record ? this.toDomain(record as RawEvent) : null;
  }

  async attachMedia(id: string, mediaUrl: string, mediaType: string): Promise<StockMovementAuditEvent> {
    const record = await this.prisma.stockMovementAuditEvent.update({
      where: { id },
      data: { mediaUrl, mediaType },
      include: { orders: true },
    });
    return this.toDomain(record as RawEvent);
  }

  // A ÚNICA escrita de StockLedgerEntry em todo o sistema — status do
  // evento e linhas de ledger na MESMA transação, para que nunca exista uma
  // janela onde um esteja consistente e o outro não (ver comentário da
  // porta e da "regra de ouro" no schema.prisma).
  async approveWithLedger(
    id: string,
    conferredByUserId: string,
    ledgerEntries: LedgerEntryInput[],
  ): Promise<StockMovementAuditEvent> {
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.stockLedgerEntry.createMany({ data: ledgerEntries });
      return tx.stockMovementAuditEvent.update({
        where: { id },
        data: {
          conferenceStatus: 'APROVADO',
          conferredByUserId,
          conferredAt: new Date(),
        },
        include: { orders: true },
      });
    });
    return this.toDomain(record as RawEvent);
  }

  findPending(tenantId: string): Promise<StockMovementAuditEvent[]> {
    return this.prisma.stockMovementAuditEvent
      .findMany({
        where: { tenantId, conferenceStatus: 'PENDENTE' },
        include: { orders: true },
        orderBy: { createdAt: 'asc' },
      })
      .then((records) => records.map((r) => this.toDomain(r as RawEvent)));
  }

  async markDivergent(id: string, conferredByUserId: string, divergenceNotes: string): Promise<StockMovementAuditEvent> {
    const record = await this.prisma.stockMovementAuditEvent.update({
      where: { id },
      data: {
        conferenceStatus: 'DIVERGENTE',
        conferredByUserId,
        conferredAt: new Date(),
        divergenceNotes,
      },
      include: { orders: true },
    });
    return this.toDomain(record as RawEvent);
  }

  private toDomain(record: RawEvent): StockMovementAuditEvent {
    return {
      id: record.id,
      tenantId: record.tenantId,
      eventType: record.eventType as StockMovementEventType,
      sourceWarehouseId: record.sourceWarehouseId,
      destinationWarehouseId: record.destinationWarehouseId,
      mediaUrl: record.mediaUrl,
      mediaType: record.mediaType,
      conferenceStatus: record.conferenceStatus as ConferenceStatus,
      conferredByUserId: record.conferredByUserId,
      conferredAt: record.conferredAt,
      divergenceNotes: record.divergenceNotes,
      invoiceNumber: record.invoiceNumber,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      orderIds: record.orders.map((o) => o.orderId),
    };
  }
}
