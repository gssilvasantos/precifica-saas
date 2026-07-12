import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { OrderRepository, OrderUpsertResult } from '../application/ports/order-repository.port';
import {
  AppDataMode,
  Order,
  OrderItem,
  OrderListFilters,
  OrderListPage,
  OrderStatus,
  OrderStatusCounts,
  OrderUpsertData,
} from '../domain/order.entity';

const ALL_STATUSES: OrderStatus[] = ['EM_ABERTO', 'PREPARANDO_ENVIO', 'FATURADO', 'ENVIADO', 'ENTREGUE', 'CANCELADO'];

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: OrderUpsertData): Promise<OrderUpsertResult> {
    // Lê o status ANTERIOR antes do upsert — é o que permite ao
    // OrderSyncOrchestrator detectar transição sem uma segunda query
    // separada (ver OrderUpsertResult.previousStatus).
    const existing = await this.prisma.order.findUnique({
      where: {
        tenantId_channelCode_externalOrderId: {
          tenantId: data.tenantId,
          channelCode: data.channelCode,
          externalOrderId: data.externalOrderId,
        },
      },
      select: { id: true, status: true },
    });

    const orderData = {
      tenantId: data.tenantId,
      channelCode: data.channelCode,
      externalOrderId: data.externalOrderId,
      status: data.status,
      externalStatus: data.externalStatus,
      subtotalAmount: data.subtotalAmount,
      shippingAmount: data.shippingAmount,
      discountAmount: data.discountAmount,
      totalAmount: data.totalAmount,
      feeAmount: data.feeAmount,
      netAmount: data.netAmount,
      currency: data.currency,
      fiscalResponsibility: data.fiscalResponsibility ?? 'SELLER',
      buyerTaxId: data.buyerTaxId ?? null,
      invoiceNumber: data.invoiceNumber ?? null,
      shippingDeadlineAt: data.shippingDeadlineAt ?? null,
      orderedAt: data.orderedAt,
      paidAt: data.paidAt ?? null,
      shippedAt: data.shippedAt ?? null,
      deliveredAt: data.deliveredAt ?? null,
      cancelledAt: data.cancelledAt ?? null,
      rawPayload: (data.rawPayload as never) ?? undefined,
      syncedAt: new Date(),
      // Audit Mode — ausente/false em todo sync real (OrderSyncOrchestrator
      // nunca passa isDemo); só AuditSeederService passa true.
      isDemo: data.isDemo ?? false,
    };

    const record = await this.prisma.order.upsert({
      where: {
        tenantId_channelCode_externalOrderId: {
          tenantId: data.tenantId,
          channelCode: data.channelCode,
          externalOrderId: data.externalOrderId,
        },
      },
      create: orderData as never,
      update: orderData as never,
      include: { items: true },
    });

    // Itens: substituição completa (delete + createMany) — mais simples e
    // seguro que tentar diffar item a item por externalSku, e o volume por
    // pedido é sempre pequeno (dezenas, não milhares).
    await this.prisma.orderItem.deleteMany({ where: { orderId: record.id } });
    if (data.items.length > 0) {
      await this.prisma.orderItem.createMany({
        data: data.items.map((item) => ({
          orderId: record.id,
          skuCode: item.skuCode ?? null,
          externalSku: item.externalSku,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          taxAmount: item.taxAmount ?? null,
          costPrice: item.costPrice ?? null,
        })) as never,
      });
    }

    const finalRecord = await this.prisma.order.findUniqueOrThrow({
      where: { id: record.id },
      include: { items: true },
    });

    return {
      order: this.toDomain(finalRecord),
      isNew: !existing,
      previousStatus: (existing?.status as OrderStatus) ?? null,
    };
  }

  async findById(tenantId: string, id: string): Promise<Order | null> {
    const record = await this.prisma.order.findFirst({ where: { id, tenantId }, include: { items: true } });
    return record ? this.toDomain(record) : null;
  }

  async findWithFilters(
    tenantId: string,
    filters: OrderListFilters,
    page: number,
    pageSize: number,
  ): Promise<OrderListPage> {
    const where = {
      tenantId,
      isDemo: this.isDemoFlag(filters.dataMode),
      ...(filters.channelCode ? { channelCode: filters.channelCode } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            orderedAt: {
              ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
              ...(filters.dateTo ? { lte: filters.dateTo } : {}),
            },
          }
        : {}),
    };

    const [records, total] = await Promise.all([
      this.prisma.order.findMany({
        where: where as never,
        include: { items: true },
        orderBy: { orderedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where: where as never }),
    ]);

    return {
      items: records.map((r) => this.toDomain(r)),
      total,
      page,
      pageSize,
    };
  }

  // Etapa 20 (DRE) — ver aviso de escala no port. Filtra só por tenant +
  // janela de orderedAt; a decisão de QUAIS status contam como receita
  // reconhecida (ex.: excluir CANCELADO) é do domínio (dre-report.ts), não
  // do repositório — este método devolve o universo bruto do período.
  // Audit Mode: dataMode ausente = 'REAL' (isDemo=false) — é este filtro,
  // aplicado aqui na camada mais baixa possível, que garante que o DRE
  // "nunca se mistura" com pedido fictício sem depender de nenhum cuidado
  // manual de quem chama.
  async findAllForPeriod(tenantId: string, dateFrom?: Date, dateTo?: Date, dataMode?: AppDataMode): Promise<Order[]> {
    const records = await this.prisma.order.findMany({
      where: {
        tenantId,
        isDemo: this.isDemoFlag(dataMode),
        ...(dateFrom || dateTo
          ? {
              orderedAt: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      } as never,
      include: { items: true },
      orderBy: { orderedAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async countByStatus(tenantId: string, dataMode?: AppDataMode): Promise<OrderStatusCounts> {
    const groups = await this.prisma.order.groupBy({
      by: ['status'],
      where: { tenantId, isDemo: this.isDemoFlag(dataMode) },
      _count: { _all: true },
    });

    // Preenche TODOS os status com 0 antes de aplicar os grupos retornados —
    // a UI (abas do worklist) precisa dos 6 contadores sempre presentes,
    // mesmo quando um status ainda não tem nenhum pedido.
    const counts = ALL_STATUSES.reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {} as OrderStatusCounts);

    for (const group of groups) {
      counts[group.status as OrderStatus] = group._count._all;
    }
    return counts;
  }

  // Audit Mode — WHERE isDemo = true EXPLÍCITO (nunca "tudo que não é
  // real"): um bug de inversão de lógica aqui apagaria dados de verdade da
  // Rita Mazzei Beauty, o pior cenário possível para este recurso. deleteMany
  // encadeia para OrderItem via onDelete: Cascade do schema.
  async deleteDemoOrders(tenantId: string): Promise<number> {
    const result = await this.prisma.order.deleteMany({ where: { tenantId, isDemo: true } });
    return result.count;
  }

  // Sprint 27 — filtra por tenantId via a relação (order: { tenantId }),
  // nunca confiando só no orderId (que já é globalmente único, mas a
  // checagem explícita evita vazar item de outro tenant caso um orderId de
  // outro tenant seja passado por engano pelo chamador).
  async findItemsByOrderIds(
    tenantId: string,
    orderIds: string[],
  ): Promise<{ orderId: string; skuCode: string | null; quantity: number }[]> {
    if (orderIds.length === 0) return [];
    const items = await this.prisma.orderItem.findMany({
      where: { orderId: { in: orderIds }, order: { tenantId } },
      select: { orderId: true, skuCode: true, quantity: true },
    });
    return items;
  }

  // Ausente = 'REAL' (isDemo=false) — o padrão seguro: qualquer chamador que
  // esqueça de passar dataMode nunca vê pedido de demonstração.
  private isDemoFlag(dataMode?: AppDataMode): boolean {
    return dataMode === 'DEMO';
  }

  private toDomain(record: {
    id: string;
    tenantId: string;
    channelCode: string;
    externalOrderId: string;
    status: string;
    externalStatus: string;
    subtotalAmount: { toString(): string };
    shippingAmount: { toString(): string };
    discountAmount: { toString(): string };
    totalAmount: { toString(): string };
    feeAmount: { toString(): string };
    netAmount: { toString(): string };
    currency: string;
    fiscalResponsibility: string;
    buyerTaxId: string | null;
    invoiceNumber: string | null;
    shippingDeadlineAt: Date | null;
    orderedAt: Date;
    paidAt: Date | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    cancelledAt: Date | null;
    syncedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    isDemo: boolean;
    items: Array<{
      id: string;
      orderId: string;
      skuCode: string | null;
      externalSku: string;
      productName: string;
      quantity: number;
      unitPrice: { toString(): string };
      totalPrice: { toString(): string };
      taxAmount: { toString(): string } | null;
      costPrice: { toString(): string } | null;
    }>;
  }): Order {
    return {
      id: record.id,
      tenantId: record.tenantId,
      channelCode: record.channelCode,
      externalOrderId: record.externalOrderId,
      status: record.status as OrderStatus,
      externalStatus: record.externalStatus,
      subtotalAmount: Number(record.subtotalAmount),
      shippingAmount: Number(record.shippingAmount),
      discountAmount: Number(record.discountAmount),
      totalAmount: Number(record.totalAmount),
      feeAmount: Number(record.feeAmount),
      netAmount: Number(record.netAmount),
      currency: record.currency,
      fiscalResponsibility: record.fiscalResponsibility as Order['fiscalResponsibility'],
      buyerTaxId: record.buyerTaxId,
      invoiceNumber: record.invoiceNumber,
      shippingDeadlineAt: record.shippingDeadlineAt,
      orderedAt: record.orderedAt,
      paidAt: record.paidAt,
      shippedAt: record.shippedAt,
      deliveredAt: record.deliveredAt,
      cancelledAt: record.cancelledAt,
      syncedAt: record.syncedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      isDemo: record.isDemo,
      items: record.items.map(
        (item): OrderItem => ({
          id: item.id,
          orderId: item.orderId,
          skuCode: item.skuCode,
          externalSku: item.externalSku,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
          taxAmount: item.taxAmount !== null ? Number(item.taxAmount) : null,
          costPrice: item.costPrice !== null ? Number(item.costPrice) : null,
        }),
      ),
    };
  }
}
