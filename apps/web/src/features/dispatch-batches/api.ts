import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/logistics-fulfillment/domain/dispatch-batch.entity.ts
// — mesmo racional de duplicação intencional do resto do frontend.
export type DispatchBatchStatus = 'ABERTO' | 'ETIQUETADO' | 'DESPACHADO' | 'CANCELADO';
export type DispatchBatchOrderStatus = 'PENDENTE' | 'ETIQUETADO' | 'ERRO';

export interface DispatchBatch {
  id: string;
  tenantId: string;
  formaEnvio: string;
  status: DispatchBatchStatus;
  requestedByUserId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  concludedAt: string | null;
}

export interface DispatchBatchOrder {
  id: string;
  tenantId: string;
  dispatchBatchId: string;
  orderId: string;
  status: DispatchBatchOrderStatus;
  externalLabelId: string | null;
  trackingCode: string | null;
  labelUrl: string | null;
  errorMessage: string | null;
  labeledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CarrierMatchResult {
  carrierServiceId: string;
  carrierId: string;
  matchedBy: 'NAME' | 'ALIAS';
  matchedValue: string;
  carrierName: string;
  serviceName: string;
  estimativaEntregaDias: number | null;
}

export interface RecipientAddressInput {
  name: string;
  document?: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface GenerateDispatchLabelInput {
  packageWeightKg?: number;
  declaredValue?: number;
  recipientAddress?: RecipientAddressInput;
  avisoRecebimento?: boolean;
  maoPropria?: boolean;
}

export async function fetchDispatchBatches(): Promise<DispatchBatch[]> {
  const { data } = await apiClient.get<DispatchBatch[]>('/logistics-fulfillment/dispatch-batches');
  return data;
}

export async function fetchDispatchBatch(id: string): Promise<{ batch: DispatchBatch; orders: DispatchBatchOrder[] }> {
  const { data } = await apiClient.get<{ batch: DispatchBatch; orders: DispatchBatchOrder[] }>(`/logistics-fulfillment/dispatch-batches/${id}`);
  return data;
}

export async function fetchCarrierMatch(batchId: string): Promise<CarrierMatchResult | null> {
  const { data } = await apiClient.get<CarrierMatchResult | null>(`/logistics-fulfillment/dispatch-batches/${batchId}/carrier-match`);
  return data;
}

export async function createDispatchBatch(input: { formaEnvio?: string; carrierServiceId?: string; notes?: string }): Promise<DispatchBatch> {
  const { data } = await apiClient.post<DispatchBatch>('/logistics-fulfillment/dispatch-batches', input);
  return data;
}

export async function addOrderToBatch(batchId: string, orderId: string): Promise<DispatchBatchOrder> {
  const { data } = await apiClient.post<DispatchBatchOrder>(`/logistics-fulfillment/dispatch-batches/${batchId}/orders`, { orderId });
  return data;
}

export async function removeOrderFromBatch(batchId: string, batchOrderId: string): Promise<void> {
  await apiClient.delete(`/logistics-fulfillment/dispatch-batches/${batchId}/orders/${batchOrderId}`);
}

export async function generateDispatchLabel(batchId: string, batchOrderId: string, input: GenerateDispatchLabelInput): Promise<DispatchBatchOrder> {
  const { data } = await apiClient.post<DispatchBatchOrder>(
    `/logistics-fulfillment/dispatch-batches/${batchId}/orders/${batchOrderId}/generate-label`,
    input,
  );
  return data;
}

export async function concludeDispatchBatch(id: string): Promise<DispatchBatch> {
  const { data } = await apiClient.post<DispatchBatch>(`/logistics-fulfillment/dispatch-batches/${id}/conclude`, {});
  return data;
}

export async function cancelDispatchBatch(id: string): Promise<DispatchBatch> {
  const { data } = await apiClient.post<DispatchBatch>(`/logistics-fulfillment/dispatch-batches/${id}/cancel`, {});
  return data;
}
