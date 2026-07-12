// Movido de marketplace-intelligence/application/ports/ na Etapa 5 — ver
// provider-sync-schedule-repository.port.ts para o racional da extração.
export interface ProviderSyncLogRepository {
  start(providerCode: string, correlationId: string): Promise<string>; // retorna o id do log
  finish(
    logId: string,
    result: { status: 'SUCCESS' | 'FAILED' | 'PARTIAL'; candidatesFound: number; candidatesApplied: number; errorDetails?: string },
  ): Promise<void>;
}

export const PROVIDER_SYNC_LOG_REPOSITORY = Symbol('PROVIDER_SYNC_LOG_REPOSITORY');
