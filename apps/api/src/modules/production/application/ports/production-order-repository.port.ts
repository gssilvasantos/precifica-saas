import { ProductionOrder, ProductionOrderCreateData, ProductionOrderStatus } from '../../domain/production-order.entity';

export interface ProductionOrderListFilters {
  status?: ProductionOrderStatus;
}

export interface ProductionOrderMarkConcludedData {
  status: 'CONCLUIDA';
  concludedAt: Date;
}

export interface ProductionOrderRepository {
  create(data: ProductionOrderCreateData): Promise<ProductionOrder>;
  findById(tenantId: string, id: string): Promise<ProductionOrder | null>;
  findAllByTenant(tenantId: string, filters?: ProductionOrderListFilters): Promise<ProductionOrder[]>;
  updateStatus(id: string, status: ProductionOrderStatus): Promise<ProductionOrder>;
  markConcluded(id: string, data: ProductionOrderMarkConcludedData): Promise<ProductionOrder>;
}

export const PRODUCTION_ORDER_REPOSITORY = Symbol('PRODUCTION_ORDER_REPOSITORY');
