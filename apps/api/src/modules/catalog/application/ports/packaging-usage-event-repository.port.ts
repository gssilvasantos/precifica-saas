import { PackagingUsageEvent, PackagingUsageEventCreateData } from '../../domain/packaging-usage-event.entity';

// Write-mostly de propósito: hoje só existe `record` (create) + `findByProduct`
// (para o futuro DRE consultar o histórico de um produto). Não há update nem
// delete — é um log de eventos, não uma entidade mutável.
export interface PackagingUsageEventRepository {
  record(data: PackagingUsageEventCreateData): Promise<PackagingUsageEvent>;
  findByProduct(tenantId: string, productId: string): Promise<PackagingUsageEvent[]>;
}

export const PACKAGING_USAGE_EVENT_REPOSITORY = Symbol('PACKAGING_USAGE_EVENT_REPOSITORY');
