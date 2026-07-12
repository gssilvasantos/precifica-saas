import { apiClient } from '../../lib/api-client';

// Modo de Demonstração / Audit Mode (ver docs/audit-mode.md) — espelha 1:1
// apps/api/src/modules/orders/domain/order.entity.ts (AppDataMode), mesmo
// racional de duplicação intencional do resto do frontend (ex.: OrderStatus
// em features/orders/api.ts).
export type AppDataMode = 'REAL' | 'DEMO';

export interface AuditStatus {
  totalDemoOrders: number;
}

export interface AuditSeedResult {
  seeded: number;
  externalOrderIds: string[];
}

export interface AuditClearResult {
  removed: number;
}

export async function fetchAuditStatus(): Promise<AuditStatus> {
  const { data } = await apiClient.get<AuditStatus>('/audit-mode/status');
  return data;
}

export async function seedAuditData(): Promise<AuditSeedResult> {
  const { data } = await apiClient.post<AuditSeedResult>('/audit-mode/seed');
  return data;
}

export async function clearAuditData(): Promise<AuditClearResult> {
  const { data } = await apiClient.post<AuditClearResult>('/audit-mode/clear');
  return data;
}
