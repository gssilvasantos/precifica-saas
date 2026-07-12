import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/logistics-fulfillment/application/replenishment-advisor.service.ts
// e domain/warehouse.entity.ts — mesmo racional de duplicação intencional
// do resto do frontend (nunca importa tipo do backend, só replica o
// formato do JSON; datas chegam como string).
export type AbcClass = 'A' | 'B' | 'C';
export type ReplenishmentStatus = 'CRITICO' | 'ATENCAO' | 'OK' | 'SEM_GIRO';

export interface ReplenishmentRow {
  skuCode: string;
  channelCode: string;
  abcClass: AbcClass;
  giroDiario: number;
  saldoFull: number;
  saldoFisico: number;
  coberturaDiasFull: number | null;
  sugestaoEnvio: number;
  status: ReplenishmentStatus;
  physicalShortfall: boolean;
  leadTimeDaysUsed: number;
}

export type WarehouseType = 'PHYSICAL' | 'VIRTUAL_FULL';

export interface Warehouse {
  id: string;
  tenantId: string;
  code: string;
  type: WarehouseType;
  channelCode: string | null;
  isActive: boolean;
  leadTimeDays: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchReplenishmentTable(channelCode: string): Promise<ReplenishmentRow[]> {
  const { data } = await apiClient.get<ReplenishmentRow[]>('/logistics-fulfillment/replenishment', {
    params: { channelCode },
  });
  return data;
}

export async function fetchWarehouses(): Promise<Warehouse[]> {
  const { data } = await apiClient.get<Warehouse[]>('/logistics-fulfillment/warehouses');
  return data;
}

// Configuração do lead time (Sprint 25) — pedido explícito do usuário para
// controlar a agressividade da reposição sem depender de deploy.
export async function updateWarehouseLeadTime(warehouseId: string, leadTimeDays: number): Promise<Warehouse> {
  const { data } = await apiClient.patch<Warehouse>(`/logistics-fulfillment/warehouses/${warehouseId}/lead-time`, {
    leadTimeDays,
  });
  return data;
}
