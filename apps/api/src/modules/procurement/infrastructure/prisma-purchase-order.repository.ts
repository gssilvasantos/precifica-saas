import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  PurchaseOrderListFilters,
  PurchaseOrderReceiveData,
  PurchaseOrderRepository,
} from '../application/ports/purchase-order-repository.port';
import { PurchaseOrder, PurchaseOrderCreateData, PurchaseOrderStatus } from '../domain/purchase-order.entity';

@Injectable()
export class PrismaPurchaseOrderRepository implements PurchaseOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: PurchaseOrderCreateData): Promise<PurchaseOrder> {
    const record = await this.prisma.purchaseOrder.create({
      data: {
        tenantId: data.tenantId,
        supplierId: data.supplierId,
        warehouseId: data.warehouseId,
        paymentDueDate: data.paymentDueDate,
        notes: data.notes ?? null,
        items: {
          create: data.items.map((item) => ({
            tenantId: data.tenantId,
            skuCode: item.skuCode,
            quantity: item.quantity,
            unitCost: item.unitCost,
            ipi: item.ipi ?? null,
          })),
        },
      },
      include: { items: true },
    });
    return this.toDomain(record as never);
  }

  async findById(tenantId: string, id: string): Promise<PurchaseOrder | null> {
    const record = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    return record ? this.toDomain(record as never) : null;
  }

  async findAllByTenant(tenantId: string, filters?: PurchaseOrderListFilters): Promise<PurchaseOrder[]> {
    const records = await this.prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        ...(filters?.status ? { status: filters.status as never } : {}),
        ...(filters?.supplierId ? { supplierId: filters.supplierId } : {}),
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r as never));
  }

  async updateStatus(id: string, status: PurchaseOrderStatus): Promise<PurchaseOrder> {
    const record = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: status as never },
      include: { items: true },
    });
    return this.toDomain(record as never);
  }

  async markReceived(id: string, data: PurchaseOrderReceiveData): Promise<PurchaseOrder> {
    const record = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: data.status as never,
        invoiceNumber: data.invoiceNumber,
        receivedAt: data.receivedAt,
      },
      include: { items: true },
    });
    return this.toDomain(record as never);
  }

  // Decimal -> number na borda (unitCost/ipi por item), mesmo padrão de
  // PrismaAccountsPayableRepository.
  private toDomain(record: {
    id: string;
    tenantId: string;
    status: string;
    supplierId: string;
    warehouseId: string;
    paymentDueDate: Date;
    notes: string | null;
    invoiceNumber: string | null;
    receivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    items: Array<{
      id: string;
      tenantId: string;
      purchaseOrderId: string;
      skuCode: string;
      quantity: number;
      unitCost: { toString(): string };
      ipi: { toString(): string } | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }): PurchaseOrder {
    return {
      id: record.id,
      tenantId: record.tenantId,
      status: record.status as PurchaseOrderStatus,
      supplierId: record.supplierId,
      warehouseId: record.warehouseId,
      paymentDueDate: record.paymentDueDate,
      notes: record.notes,
      invoiceNumber: record.invoiceNumber,
      receivedAt: record.receivedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      items: record.items.map((item) => ({
        id: item.id,
        tenantId: item.tenantId,
        purchaseOrderId: item.purchaseOrderId,
        skuCode: item.skuCode,
        quantity: item.quantity,
        unitCost: Number(item.unitCost),
        ipi: item.ipi ? Number(item.ipi) : null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    };
  }
}
