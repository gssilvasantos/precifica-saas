// Movido de marketplace-intelligence/application/ports/ na Etapa 5 — a
// tabela virou infraestrutura genérica de sincronização (schema
// integration_ops), compartilhada por Marketplace Intelligence e
// erp-integration. Ver docs/erp-integration-architecture.md, seção 5.
export interface ProviderSyncSchedule {
  id: string;
  providerCode: string;
  marketplaceId: string; // referência solta (não FK) — ver schema.prisma
  capability: string;
  intervalMinutes: number;
  isEnabled: boolean;
  autoTrust: boolean;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
}

export interface ProviderSyncScheduleRepository {
  findDue(now: Date): Promise<ProviderSyncSchedule[]>;
  findByProviderCode(providerCode: string): Promise<ProviderSyncSchedule | null>;
  markRun(id: string, status: string, ranAt: Date): Promise<void>;
  upsert(data: {
    providerCode: string;
    marketplaceId: string;
    capability: string;
    intervalMinutes: number;
    autoTrust?: boolean;
  }): Promise<ProviderSyncSchedule>;
}

export const PROVIDER_SYNC_SCHEDULE_REPOSITORY = Symbol('PROVIDER_SYNC_SCHEDULE_REPOSITORY');
