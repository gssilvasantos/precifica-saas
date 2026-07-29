import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ProductionOrderListFilters,
  ProductionOrderMarkConcludedData,
  ProductionOrderRepository,
} from '../application/ports/production-order-repository.port';
import { ProductionOrder, ProductionOrderCreateData, ProductionOrderStatus } from '../domain/production-order.entity';

@Injectable()
export class PrismaProductionOrderRepository implements ProductionOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: ProductionOrderCreateData): Promise<ProductionOrder> {
    const record = await this.prisma.productionOrder.create({
      data: {
        tenantId: data.tenantId,
        parentSkuCode: data.parentSkuCode,
        quantity: data.quantity,
        sourceWarehouseId: data.sourceWarehouseId,
        destinationWarehouseId: data.destinationWarehouseId,
        notes: data.notes ?? null,
        components: {
          create: data.components.map((c) => ({
            tenantId: data.tenantId,
            componentSkuCode: c.componentSkuCode,
            quantityPerUnit: c.quantityPerUnit,
            totalQuantity: c.totalQuantity,
          })),
        },
      },
      include: { components: true },
    });
    return this.toDomain(record);
  }

  async findById(tenantId: string, id: string): Promise<ProductionOrder | null> {
    const record = await this.prisma.productionOrder.findFirst({
      where: { id, tenantId },
      include: { components: true },
    });
    return record ? this.toDomain(record) : null;
  }

  async findAllByTenant(tenantId: string, filters?: ProductionOrderListFilters): Promise<ProductionOrder[]> {
    const records = await this.prisma.productionOrder.findMany({
      where: { tenantId, ...(filters?.status ? { status: filters.status } : {}) },
      include: { components: true },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async updateStatus(id: string, status: ProductionOrderStatus): Promise<ProductionOrder> {
    const record = await this.prisma.productionOrder.update({
      where: { id },
      data: { status },
      include: { components: true },
    });
    return this.toDomain(record);
  }

  async markConcluded(id: string, data: ProductionOrderMarkConcludedData): Promise<ProductionOrder> {
    const record = await this.prisma.productionOrder.update({
      where: { id },
      data: { status: data.status, concludedAt: data.concludedAt },
      include: { components: true },
    });
    return this.toDomain(record);
  }

  private toDomain(
    record: Record<string, unknown> & {
      quantity: number;
      components: Array<Record<string, unknown> & { quantityPerUnit: { toString(): string }; totalQuantity: { toString(): string } }>;
    },
  ): ProductionOrder {
    return {
      ...record,
      components: record.components.map((c) => ({
        ...c,
        quantityPerUnit: Number(c.quantityPerUnit),
        totalQuantity: Number(c.totalQuantity),
      })),
    } as ProductionOrder;
  }
}
