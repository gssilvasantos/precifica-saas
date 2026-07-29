import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { DispatchBatchOrder, DispatchBatchOrderStatus } from '../domain/dispatch-batch.entity';
import { DispatchBatchOrderRepository } from '../application/ports/dispatch-batch-order-repository.port';

@Injectable()
export class PrismaDispatchBatchOrderRepository implements DispatchBatchOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async add(tenantId: string, dispatchBatchId: string, orderId: string): Promise<DispatchBatchOrder> {
    const record = await this.prisma.dispatchBatchOrder.create({
      data: { tenantId, dispatchBatchId, orderId },
    });
    return this.toDomain(record);
  }

  async findById(tenantId: string, id: string): Promise<DispatchBatchOrder | null> {
    const record = await this.prisma.dispatchBatchOrder.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record) : null;
  }

  async findAllByBatch(tenantId: string, dispatchBatchId: string): Promise<DispatchBatchOrder[]> {
    const records = await this.prisma.dispatchBatchOrder.findMany({ where: { tenantId, dispatchBatchId } });
    return records.map((r) => this.toDomain(r));
  }

  // "Ativo" = o lote-pai ainda não está DESPACHADO/CANCELADO — join via
  // relação Prisma (dispatchBatch), não uma segunda query manual.
  async findActiveByOrder(tenantId: string, orderId: string): Promise<DispatchBatchOrder | null> {
    const record = await this.prisma.dispatchBatchOrder.findFirst({
      where: { tenantId, orderId, dispatchBatch: { status: { in: ['ABERTO', 'ETIQUETADO'] } } },
    });
    return record ? this.toDomain(record) : null;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.dispatchBatchOrder.deleteMany({ where: { tenantId, id } });
  }

  async markLabeled(id: string, data: { trackingCode?: string; labelUrl?: string; externalLabelId?: string }): Promise<DispatchBatchOrder> {
    const record = await this.prisma.dispatchBatchOrder.update({
      where: { id },
      data: {
        status: 'ETIQUETADO',
        trackingCode: data.trackingCode ?? undefined,
        labelUrl: data.labelUrl ?? undefined,
        externalLabelId: data.externalLabelId ?? undefined,
        labeledAt: new Date(),
        errorMessage: null,
      },
    });
    return this.toDomain(record);
  }

  async markError(id: string, errorMessage: string): Promise<DispatchBatchOrder> {
    const record = await this.prisma.dispatchBatchOrder.update({
      where: { id },
      data: { status: 'ERRO', errorMessage },
    });
    return this.toDomain(record);
  }

  private toDomain(record: {
    id: string;
    tenantId: string;
    dispatchBatchId: string;
    orderId: string;
    status: string;
    externalLabelId: string | null;
    trackingCode: string | null;
    labelUrl: string | null;
    errorMessage: string | null;
    labeledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): DispatchBatchOrder {
    return {
      id: record.id,
      tenantId: record.tenantId,
      dispatchBatchId: record.dispatchBatchId,
      orderId: record.orderId,
      status: record.status as DispatchBatchOrderStatus,
      externalLabelId: record.externalLabelId,
      trackingCode: record.trackingCode,
      labelUrl: record.labelUrl,
      errorMessage: record.errorMessage,
      labeledAt: record.labeledAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
