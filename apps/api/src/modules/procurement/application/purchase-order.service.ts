import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PURCHASE_ORDER_REPOSITORY,
  PurchaseOrderListFilters,
  PurchaseOrderRepository,
} from './ports/purchase-order-repository.port';
import { SUPPLIER_REPOSITORY, SupplierRepository } from '../../catalog/application/ports/supplier-repository.port';
import { WAREHOUSE_REPOSITORY, WarehouseRepository } from '../../logistics-fulfillment/application/ports/warehouse-repository.port';
import { STOCK_RECEIPT_WRITER, StockReceiptWriter } from '../../../shared/contracts/stock-receipt-writer.port';
import { ACCOUNTS_PAYABLE_WRITER, AccountsPayableWriter } from '../../../shared/contracts/accounts-payable-writer.port';
import {
  PurchaseOrder,
  PurchaseOrderItemInput,
  canAdvance,
  canCancel,
  canReceive,
  computeTotalAmount,
  isValidItems,
} from '../domain/purchase-order.entity';

export interface CreatePurchaseOrderInput {
  supplierId: string;
  warehouseId: string;
  paymentDueDate: Date;
  notes?: string | null;
  items: PurchaseOrderItemInput[];
}

// Bounded context: procurement (schema Prisma próprio, ver
// prisma/schema.prisma). Fecha o ciclo do ReplenishmentAdvisor
// (logistics-fulfillment): humano decide comprar -> cria a ordem aqui ->
// "receber" credita estoque E gera conta a pagar, nos dois casos por PORTA
// exportada, nunca importando a classe concreta do outro módulo. Ver
// docs/procurement-architecture.md.
@Injectable()
export class PurchaseOrderService {
  constructor(
    @Inject(PURCHASE_ORDER_REPOSITORY) private readonly orders: PurchaseOrderRepository,
    @Inject(SUPPLIER_REPOSITORY) private readonly suppliers: SupplierRepository,
    @Inject(WAREHOUSE_REPOSITORY) private readonly warehouses: WarehouseRepository,
    @Inject(STOCK_RECEIPT_WRITER) private readonly stockReceiptWriter: StockReceiptWriter,
    @Inject(ACCOUNTS_PAYABLE_WRITER) private readonly accountsPayableWriter: AccountsPayableWriter,
  ) {}

  async create(tenantId: string, input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
    if (!isValidItems(input.items)) {
      throw new BadRequestException(
        'Informe ao menos um item com skuCode, quantity inteiro positivo e unitCost não negativo.',
      );
    }
    await this.assertSupplierBelongsToTenant(tenantId, input.supplierId);
    await this.assertWarehouseBelongsToTenant(tenantId, input.warehouseId);

    return this.orders.create({
      tenantId,
      supplierId: input.supplierId,
      warehouseId: input.warehouseId,
      paymentDueDate: input.paymentDueDate,
      notes: input.notes ?? null,
      items: input.items,
    });
  }

  findOne(tenantId: string, id: string): Promise<PurchaseOrder | null> {
    return this.requireOrder(tenantId, id);
  }

  list(tenantId: string, filters?: PurchaseOrderListFilters): Promise<PurchaseOrder[]> {
    return this.orders.findAllByTenant(tenantId, filters);
  }

  // ABERTO -> ANDAMENTO — sem nenhum efeito colateral cross-módulo, só marca
  // "em negociação/trânsito com o fornecedor".
  async advance(tenantId: string, id: string): Promise<PurchaseOrder> {
    const order = await this.requireOrder(tenantId, id);
    const check = canAdvance(order);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }
    return this.orders.updateStatus(id, 'ANDAMENTO');
  }

  async cancel(tenantId: string, id: string): Promise<PurchaseOrder> {
    const order = await this.requireOrder(tenantId, id);
    const check = canCancel(order);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }
    if (order.status === 'CANCELADO') {
      return order; // idempotente
    }
    return this.orders.updateStatus(id, 'CANCELADO');
  }

  // A ação combinada "recebi a mercadoria": credita estoque no depósito de
  // destino (Hub de Provas, tipo PURCHASE_RECEIPT) E lança a conta a pagar
  // do fornecedor, então marca ATENDIDO com a NF e a data de recebimento.
  // Nunca lança só um dos dois lados — se o crédito de estoque falhar, a
  // exceção propaga ANTES de qualquer chamada à conta a pagar; se ela falhar
  // depois, a ordem fica sem o status ATENDIDO (nunca marcamos recebido sem
  // as duas pontas confirmadas).
  async receive(
    tenantId: string,
    id: string,
    invoiceNumber: string,
    conferredByUserId: string,
  ): Promise<PurchaseOrder> {
    if (!invoiceNumber || invoiceNumber.trim().length === 0) {
      throw new BadRequestException('Número da Nota Fiscal do fornecedor é obrigatório para dar entrada.');
    }

    const order = await this.requireOrder(tenantId, id);
    const check = canReceive(order);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    await this.stockReceiptWriter.receivePurchase(
      tenantId,
      order.warehouseId,
      invoiceNumber,
      conferredByUserId,
      order.items.map((item) => ({ skuCode: item.skuCode, quantity: item.quantity })),
    );

    const totalAmount = computeTotalAmount(order.items);
    await this.accountsPayableWriter.createSingle(tenantId, {
      amount: totalAmount,
      description: `Ordem de Compra ${order.id} — NF ${invoiceNumber}`,
      supplierId: order.supplierId,
      dueDate: order.paymentDueDate,
      notes: order.notes,
    });

    return this.orders.markReceived(id, {
      status: 'ATENDIDO',
      invoiceNumber,
      receivedAt: new Date(),
    });
  }

  private async requireOrder(tenantId: string, id: string): Promise<PurchaseOrder> {
    const order = await this.orders.findById(tenantId, id);
    if (!order) throw new NotFoundException(`Ordem de compra ${id} não encontrada.`);
    return order;
  }

  private async assertSupplierBelongsToTenant(tenantId: string, supplierId: string): Promise<void> {
    const supplier = await this.suppliers.findById(tenantId, supplierId);
    if (!supplier) {
      throw new BadRequestException(`Fornecedor ${supplierId} não encontrado para este tenant.`);
    }
  }

  private async assertWarehouseBelongsToTenant(tenantId: string, warehouseId: string): Promise<void> {
    const warehouse = await this.warehouses.findById(warehouseId);
    if (!warehouse || warehouse.tenantId !== tenantId) {
      throw new BadRequestException(`Depósito ${warehouseId} não encontrado para este tenant.`);
    }
  }
}
