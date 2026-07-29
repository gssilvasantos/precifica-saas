import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { OrderRepository, OrderUpsertResult } from '../application/ports/order-repository.port';
import {
  AppDataMode,
  CommissionLine,
  Order,
  OrderItem,
  OrderListFilters,
  OrderListPage,
  OrderStatus,
  OrderStatusCounts,
  OrderUpsertData,
} from '../domain/order.entity';
import { resolveEffectiveStatus } from '../domain/order-status-guard';

const ALL_STATUSES: OrderStatus[] = [
  'EM_ABERTO',
  'APROVADO',
  'PREPARANDO_ENVIO',
  'FATURADO',
  'ENVIADO',
  'ENTREGUE',
  'NAO_ENTREGUE',
  'CANCELADO',
];

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
      select: { id: true, status: true, shippingStatusCheckedAt: true },
    });

    // Reestruturação do sync ML (25-26/07/2026, ver README e
    // domain/order-status-guard.ts) — nunca aplica o status recebido
    // diretamente: uma resync sem informação nova de envio (fast path)
    // devolve sempre o fallback PREPARANDO_ENVIO para pedido pago, o que
    // regrediria um pedido já confirmado ENVIADO/ENTREGUE pelo
    // MercadoLivreShipmentEnrichmentJob de volta. resolveEffectiveStatus
    // nunca deixa o status andar pra trás (exceto virar CANCELADO).
    const effectiveStatus = resolveEffectiveStatus((existing?.status as OrderStatus) ?? null, data.status);

    const orderData = {
      tenantId: data.tenantId,
      channelCode: data.channelCode,
      externalOrderId: data.externalOrderId,
      status: effectiveStatus,
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
      // PRESERVA o valor existente quando o chamador não passa nada
      // (fast path normal, qualquer canal) — nunca reseta pra null "de
      // graça". Só MercadoLivreShipmentEnrichmentJob passa um valor
      // explícito aqui, sempre que consulta de verdade o sub-recurso de
      // envio (ver domain/order.entity.ts, comentário de OrderUpsertData).
      shippingStatusCheckedAt: data.shippingStatusCheckedAt !== undefined ? data.shippingStatusCheckedAt : existing?.shippingStatusCheckedAt ?? null,
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

  // channelCode ausente/vazio = TODOS os canais (bug de produção 26/07/2026:
  // este método nunca aceitou channelCode — as abas de status da tela de
  // Pedidos sempre mostraram contagem global, mesmo com um canal específico
  // selecionado no dropdown do frontend, que já filtra findWithFilters
  // corretamente por channelCode. Corrigido tornando o filtro explícito e
  // consistente com o resto do repositório.
  async countByStatus(tenantId: string, dataMode?: AppDataMode, channelCode?: string): Promise<OrderStatusCounts> {
    const groups = await this.prisma.order.groupBy({
      by: ['status'],
      where: { tenantId, isDemo: this.isDemoFlag(dataMode), ...(channelCode ? { channelCode } : {}) },
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

  // Ver comentário no port — usado só pelo OrderSyncOrchestrator para
  // decidir a largura da janela `since` da primeira sincronização de um
  // canal. count com take implícito 1 via `findFirst` seria uma opção, mas
  // `count` com early-exit não existe no Prisma — como isto roda uma vez por
  // (tenant, provider) por ciclo de sync (não por pedido), o custo de um
  // count completo é irrelevante aqui.
  async hasAnyOrderForChannel(tenantId: string, channelCode: string): Promise<boolean> {
    const existing = await this.prisma.order.findFirst({
      where: { tenantId, channelCode },
      select: { id: true },
    });
    return existing !== null;
  }

  // Reestruturação do sync ML (25-26/07/2026, ver README e port) — usa o
  // índice composto (tenantId, channelCode, status, shippingStatusCheckedAt,
  // orderedAt) declarado em schema.prisma. isDemo=false explícito (mesmo
  // padrão do resto do repositório): a varredura de enriquecimento nunca
  // gasta uma chamada de API real num pedido fictício do Audit Mode.
  async findPendingShipmentEnrichment(tenantId: string, channelCode: string, limit: number): Promise<Order[]> {
    const records = await this.prisma.order.findMany({
      where: {
        tenantId,
        channelCode,
        status: 'PREPARANDO_ENVIO',
        shippingStatusCheckedAt: null,
        isDemo: false,
      },
      include: { items: true },
      orderBy: { orderedAt: 'asc' },
      take: limit,
    });
    return records.map((r) => this.toDomain(r));
  }

  // Ausente = 'REAL' (isDemo=false) — o padrão seguro: qualquer chamador que
  // esqueça de passar dataMode nunca vê pedido de demonstração.
  private isDemoFlag(dataMode?: AppDataMode): boolean {
    return dataMode === 'DEMO';
  }

  // Vendedores + Comissão — lookup mínimo antes de calcular a comissão (ver
  // CommissionService.assignVendedor). Mesmo racional de defesa em
  // profundidade do método seguinte: `where` com order.tenantId.
  async findItemForCommission(tenantId: string, orderId: string, itemId: string): Promise<{ id: string; totalPrice: number } | null> {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId, order: { tenantId } },
      select: { id: true, totalPrice: true },
    });
    return item ? { id: item.id, totalPrice: Number(item.totalPrice) } : null;
  }

  // Vendedores + Comissão (Projeto Estruturante 3, benchmark Bling ERP,
  // 29/07/2026) — o `where` com order.tenantId garante que um itemId de
  // outro tenant nunca é alcançado, mesmo que orderId/itemId venham
  // corretos mas de um tenant diferente (defesa em profundidade, mesmo
  // racional de RLS por linha).
  async assignVendedorToItem(
    tenantId: string,
    orderId: string,
    itemId: string,
    data: { vendedorId: string; comissaoAliquotaPct: number; comissaoValor: number },
  ): Promise<{ id: string; totalPrice: number } | null> {
    const existing = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId, order: { tenantId } },
      select: { id: true },
    });
    if (!existing) return null;

    const updated = await this.prisma.orderItem.update({
      where: { id: itemId },
      data: {
        vendedorId: data.vendedorId,
        comissaoAliquotaPct: data.comissaoAliquotaPct,
        comissaoValor: data.comissaoValor,
      } as never,
      select: { id: true, totalPrice: true },
    });
    return { id: updated.id, totalPrice: Number(updated.totalPrice) };
  }

  // dateFrom/dateTo filtram por Order.orderedAt (não por quando a comissão
  // foi atribuída) — mesmo racional temporal do resto do relatório
  // financeiro (findAllForPeriod). onlyPending=true (usado por
  // CommissionService.generatePayout) filtra comissaoPagaEm IS NULL —
  // nunca soma uma comissão já incluída numa conta a pagar anterior.
  async findCommissionLines(
    tenantId: string,
    vendedorId: string,
    options?: { dateFrom?: Date; dateTo?: Date; onlyPending?: boolean },
  ): Promise<CommissionLine[]> {
    const items = await this.prisma.orderItem.findMany({
      where: {
        vendedorId,
        order: {
          tenantId,
          ...(options?.dateFrom || options?.dateTo
            ? {
                orderedAt: {
                  ...(options?.dateFrom ? { gte: options.dateFrom } : {}),
                  ...(options?.dateTo ? { lte: options.dateTo } : {}),
                },
              }
            : {}),
        },
        ...(options?.onlyPending ? { comissaoPagaEm: null } : {}),
      } as never,
      include: { order: { select: { id: true, externalOrderId: true, orderedAt: true } } },
      orderBy: { order: { orderedAt: 'asc' } },
    });

    return (items as never as Array<{
      id: string;
      skuCode: string | null;
      productName: string;
      totalPrice: { toString(): string };
      comissaoAliquotaPct: { toString(): string } | null;
      comissaoValor: { toString(): string } | null;
      comissaoPagaEm: Date | null;
      order: { id: string; externalOrderId: string; orderedAt: Date };
    }>).map((item) => ({
      orderItemId: item.id,
      orderId: item.order.id,
      externalOrderId: item.order.externalOrderId,
      skuCode: item.skuCode,
      productName: item.productName,
      base: Number(item.totalPrice),
      aliquotaPct: item.comissaoAliquotaPct !== null ? Number(item.comissaoAliquotaPct) : 0,
      valor: item.comissaoValor !== null ? Number(item.comissaoValor) : 0,
      orderedAt: item.order.orderedAt,
      comissaoPagaEm: item.comissaoPagaEm,
    }));
  }

  // Chamado só DEPOIS que a AccountsPayable correspondente já foi criada
  // com sucesso (ver CommissionService.generatePayout) — nunca marca pago
  // "otimisticamente" antes da conta existir de fato.
  async markCommissionsPaid(tenantId: string, orderItemIds: string[], paidAt: Date): Promise<number> {
    if (orderItemIds.length === 0) return 0;
    const result = await this.prisma.orderItem.updateMany({
      where: { id: { in: orderItemIds }, order: { tenantId } },
      data: { comissaoPagaEm: paidAt },
    });
    return result.count;
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
    shippingStatusCheckedAt: Date | null;
    rawPayload: unknown;
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
      vendedorId: string | null;
      comissaoAliquotaPct: { toString(): string } | null;
      comissaoValor: { toString(): string } | null;
      comissaoPagaEm: Date | null;
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
      shippingStatusCheckedAt: record.shippingStatusCheckedAt,
      rawPayload: record.rawPayload,
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
          vendedorId: item.vendedorId,
          comissaoAliquotaPct: item.comissaoAliquotaPct !== null ? Number(item.comissaoAliquotaPct) : null,
          comissaoValor: item.comissaoValor !== null ? Number(item.comissaoValor) : null,
          comissaoPagaEm: item.comissaoPagaEm,
        }),
      ),
    };
  }
}
