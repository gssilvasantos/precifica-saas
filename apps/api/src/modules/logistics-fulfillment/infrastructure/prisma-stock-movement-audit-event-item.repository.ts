import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { StockMovementAuditEventItemRepository } from '../application/ports/stock-movement-audit-event-item-repository.port';
import {
  StockMovementAuditEventItem,
  StockMovementAuditEventItemCreateData,
} from '../domain/stock-movement-audit-event.entity';

type RawItem = {
  id: string;
  tenantId: string;
  auditEventId: string;
  skuCode: string;
  expectedQuantity: number;
  scannedQuantity: number;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaStockMovementAuditEventItemRepository implements StockMovementAuditEventItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(items: StockMovementAuditEventItemCreateData[]): Promise<StockMovementAuditEventItem[]> {
    if (items.length === 0) return [];
    // createMany do Prisma não devolve as linhas criadas — buscamos de volta
    // pelo mesmo auditEventId logo em seguida (mesma escrita lógica, todos os
    // itens deste evento pertencem à mesma chamada de createPending).
    await this.prisma.stockMovementAuditEventItem.createMany({
      data: items.map((item) => ({
        tenantId: item.tenantId,
        auditEventId: item.auditEventId,
        skuCode: item.skuCode,
        expectedQuantity: item.expectedQuantity,
      })),
    });
    const auditEventId = items[0].auditEventId;
    const records = await this.prisma.stockMovementAuditEventItem.findMany({
      where: { auditEventId },
    });
    return records.map((r) => this.toDomain(r as RawItem));
  }

  async findByAuditEvent(tenantId: string, auditEventId: string): Promise<StockMovementAuditEventItem[]> {
    const records = await this.prisma.stockMovementAuditEventItem.findMany({
      where: { tenantId, auditEventId },
    });
    return records.map((r) => this.toDomain(r as RawItem));
  }

  async findOneBySku(tenantId: string, auditEventId: string, skuCode: string): Promise<StockMovementAuditEventItem | null> {
    const record = await this.prisma.stockMovementAuditEventItem.findFirst({
      where: { tenantId, auditEventId, skuCode },
    });
    return record ? this.toDomain(record as RawItem) : null;
  }

  // +1 atômico no banco (increment), nunca lê-modifica-escreve na aplicação
  // — evita perder incremento em bipagens concorrentes na mesma linha.
  async incrementScanned(id: string): Promise<StockMovementAuditEventItem> {
    const record = await this.prisma.stockMovementAuditEventItem.update({
      where: { id },
      data: { scannedQuantity: { increment: 1 } },
    });
    return this.toDomain(record as RawItem);
  }

  private toDomain(record: RawItem): StockMovementAuditEventItem {
    return {
      id: record.id,
      tenantId: record.tenantId,
      auditEventId: record.auditEventId,
      skuCode: record.skuCode,
      expectedQuantity: record.expectedQuantity,
      scannedQuantity: record.scannedQuantity,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
