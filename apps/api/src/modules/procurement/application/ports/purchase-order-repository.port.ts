import { PurchaseOrder, PurchaseOrderCreateData, PurchaseOrderStatus } from '../../domain/purchase-order.entity';

export interface PurchaseOrderListFilters {
  status?: PurchaseOrderStatus;
  supplierId?: string;
}

export interface PurchaseOrderReceiveData {
  status: PurchaseOrderStatus;
  invoiceNumber: string;
  receivedAt: Date;
}

export interface PurchaseOrderRepository {
  create(data: PurchaseOrderCreateData): Promise<PurchaseOrder>;
  findById(tenantId: string, id: string): Promise<PurchaseOrder | null>;
  findAllByTenant(tenantId: string, filters?: PurchaseOrderListFilters): Promise<PurchaseOrder[]>;
  updateStatus(id: string, status: PurchaseOrderStatus): Promise<PurchaseOrder>;
  // Grava status ATENDIDO + invoiceNumber + receivedAt atomicamente — única
  // transição que também preenche esses dois campos (ver
  // PurchaseOrderService.receive), nunca passa pelo updateStatus genérico.
  markReceived(id: string, data: PurchaseOrderReceiveData): Promise<PurchaseOrder>;
}

export const PURCHASE_ORDER_REPOSITORY = Symbol('PURCHASE_ORDER_REPOSITORY');
