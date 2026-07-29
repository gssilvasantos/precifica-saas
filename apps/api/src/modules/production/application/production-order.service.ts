import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PRODUCTION_ORDER_REPOSITORY,
  ProductionOrderListFilters,
  ProductionOrderRepository,
} from './ports/production-order-repository.port';
import { PRODUCT_CATALOG_READER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { PRODUCT_STRUCTURE_READER, ProductStructureReader } from '../../../shared/contracts/product-structure-reader.port';
import { PRODUCTION_STOCK_WRITER, ProductionStockWriter } from '../../../shared/contracts/production-stock-writer.port';
import { WAREHOUSE_REPOSITORY, WarehouseRepository } from '../../logistics-fulfillment/application/ports/warehouse-repository.port';
import { ProductionOrder, canCancel, canConclude, canStart, isValidQuantity } from '../domain/production-order.entity';
import { resolveComponentRequirements } from '../../catalog/domain/product-structure';

export interface CreateProductionOrderInput {
  parentSkuCode: string;
  quantity: number;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  notes?: string | null;
}

// Bounded context: production (schema Prisma próprio). Fecha o ciclo entre
// a BOM (catalog.ProductStructureComponent, via PRODUCT_STRUCTURE_READER) e
// o Hub de Provas (logistics_fulfillment, via PRODUCTION_STOCK_WRITER) — ver
// docs/production-architecture.md. Nunca importa a classe concreta de outro
// módulo, só a porta + interface, mesmo padrão de PurchaseOrderService.
@Injectable()
export class ProductionOrderService {
  constructor(
    @Inject(PRODUCTION_ORDER_REPOSITORY) private readonly orders: ProductionOrderRepository,
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    @Inject(PRODUCT_STRUCTURE_READER) private readonly structures: ProductStructureReader,
    @Inject(WAREHOUSE_REPOSITORY) private readonly warehouses: WarehouseRepository,
    @Inject(PRODUCTION_STOCK_WRITER) private readonly stockWriter: ProductionStockWriter,
  ) {}

  async create(tenantId: string, input: CreateProductionOrderInput): Promise<ProductionOrder> {
    if (!isValidQuantity(input.quantity)) {
      throw new BadRequestException('quantity deve ser um inteiro positivo.');
    }

    const parent = await this.catalog.findBySku(tenantId, input.parentSkuCode);
    if (!parent) {
      throw new BadRequestException(`Produto ${input.parentSkuCode} não encontrado para este tenant.`);
    }
    if (!parent.isKit) {
      throw new BadRequestException(
        `Produto ${input.parentSkuCode} não está marcado como kit (isKit=false) — não é possível abrir uma ordem de produção.`,
      );
    }

    await this.assertWarehouseBelongsToTenant(tenantId, input.sourceWarehouseId);
    await this.assertWarehouseBelongsToTenant(tenantId, input.destinationWarehouseId);

    const bom = await this.structures.getComponents(tenantId, input.parentSkuCode);
    if (bom.length === 0) {
      throw new BadRequestException(
        `Produto ${input.parentSkuCode} não tem estrutura de componentes cadastrada (BOM vazia) — cadastre a estrutura antes de abrir uma ordem de produção.`,
      );
    }

    const requirements = resolveComponentRequirements(bom, input.quantity);

    return this.orders.create({
      tenantId,
      parentSkuCode: input.parentSkuCode,
      quantity: input.quantity,
      sourceWarehouseId: input.sourceWarehouseId,
      destinationWarehouseId: input.destinationWarehouseId,
      notes: input.notes ?? null,
      // ResolvedComponentRequirement (catalog/domain/product-structure.ts)
      // tem o MESMO shape de ProductionOrderComponentCreateData de
      // propósito — nenhuma transformação extra necessária.
      components: requirements,
    });
  }

  findOne(tenantId: string, id: string): Promise<ProductionOrder | null> {
    return this.requireOrder(tenantId, id);
  }

  list(tenantId: string, filters?: ProductionOrderListFilters): Promise<ProductionOrder[]> {
    return this.orders.findAllByTenant(tenantId, filters);
  }

  // RASCUNHO -> EM_ANDAMENTO — sem nenhum efeito colateral cross-módulo, só
  // marca "em produção" para uso operacional/informativo.
  async start(tenantId: string, id: string): Promise<ProductionOrder> {
    const order = await this.requireOrder(tenantId, id);
    const check = canStart(order);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }
    return this.orders.updateStatus(id, 'EM_ANDAMENTO');
  }

  async cancel(tenantId: string, id: string): Promise<ProductionOrder> {
    const order = await this.requireOrder(tenantId, id);
    const check = canCancel(order);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }
    if (order.status === 'CANCELADA') {
      return order; // idempotente
    }
    return this.orders.updateStatus(id, 'CANCELADA');
  }

  // A ação combinada "concluí a produção": debita os componentes (snapshot
  // congelado na criação) no depósito de origem E credita o produto acabado
  // no depósito de destino (Hub de Provas, tipo PRODUCTION_OUTPUT), então
  // marca CONCLUIDA. Nunca marca CONCLUIDA se o movimento de estoque falhar
  // — a exceção propaga antes.
  async conclude(tenantId: string, id: string, conferredByUserId: string): Promise<ProductionOrder> {
    const order = await this.requireOrder(tenantId, id);
    const check = canConclude(order);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    await this.stockWriter.produceOutput(
      tenantId,
      order.sourceWarehouseId,
      order.destinationWarehouseId,
      conferredByUserId,
      order.components.map((c) => ({ skuCode: c.componentSkuCode, quantity: c.totalQuantity })),
      { skuCode: order.parentSkuCode, quantity: order.quantity },
    );

    return this.orders.markConcluded(id, { status: 'CONCLUIDA', concludedAt: new Date() });
  }

  private async requireOrder(tenantId: string, id: string): Promise<ProductionOrder> {
    const order = await this.orders.findById(tenantId, id);
    if (!order) throw new NotFoundException(`Ordem de produção ${id} não encontrada.`);
    return order;
  }

  private async assertWarehouseBelongsToTenant(tenantId: string, warehouseId: string): Promise<void> {
    const warehouse = await this.warehouses.findById(warehouseId);
    if (!warehouse || warehouse.tenantId !== tenantId) {
      throw new BadRequestException(`Depósito ${warehouseId} não encontrado para este tenant.`);
    }
  }
}
