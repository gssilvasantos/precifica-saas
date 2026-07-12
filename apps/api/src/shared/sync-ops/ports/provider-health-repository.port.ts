// Movido de marketplace-intelligence/application/ports/ na Etapa 5 — ver
// provider-sync-schedule-repository.port.ts para o racional da extração.
export interface ProviderHealthRepository {
  recordSuccess(providerCode: string): Promise<void>;
  recordFailure(providerCode: string, error: string): Promise<number>; // retorna consecutiveFailures atualizado
}

export const PROVIDER_HEALTH_REPOSITORY = Symbol('PROVIDER_HEALTH_REPOSITORY');
