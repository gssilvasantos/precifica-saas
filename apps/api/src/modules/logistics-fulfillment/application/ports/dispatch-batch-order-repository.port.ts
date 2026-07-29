import { DispatchBatchOrder } from '../../domain/dispatch-batch.entity';

export interface DispatchBatchOrderRepository {
  add(tenantId: string, dispatchBatchId: string, orderId: string): Promise<DispatchBatchOrder>;
  findById(tenantId: string, id: string): Promise<DispatchBatchOrder | null>;
  findAllByBatch(tenantId: string, dispatchBatchId: string): Promise<DispatchBatchOrder[]>;
  // "Ativo" = pertence a um lote ainda não DESPACHADO/CANCELADO — usado pelo
  // gate canAddOrderToBatch (um pedido não pode estar em dois lotes abertos
  // ao mesmo tempo). Ver DispatchBatchService.addOrder.
  findActiveByOrder(tenantId: string, orderId: string): Promise<DispatchBatchOrder | null>;
  remove(tenantId: string, id: string): Promise<void>;
  markLabeled(id: string, data: { trackingCode?: string; labelUrl?: string; externalLabelId?: string }): Promise<DispatchBatchOrder>;
  markError(id: string, errorMessage: string): Promise<DispatchBatchOrder>;
}

export const DISPATCH_BATCH_ORDER_REPOSITORY = Symbol('DISPATCH_BATCH_ORDER_REPOSITORY');
