// MonitoredCompetitorListing — a CONFIGURAÇÃO de "o que monitorar" (não
// histórico, não read-model). Ver comentário no schema.prisma.

export interface MonitoredListing {
  id: string;
  tenantId: string;
  skuCode: string;
  competitorLabel: string;
  targetRef: string;
  radarCode: string;
  channelCode: string | null;
  isActive: boolean;
}

export interface MonitoredListingCreateData {
  tenantId: string;
  skuCode: string;
  competitorLabel: string;
  targetRef: string;
  radarCode: string;
  channelCode?: string;
}

export interface MonitoredListingRepository {
  create(data: MonitoredListingCreateData): Promise<MonitoredListing>;
  findAllActive(): Promise<MonitoredListing[]>;
  findAllActiveByTenant(tenantId: string): Promise<MonitoredListing[]>;
  setActive(id: string, tenantId: string, isActive: boolean): Promise<void>;
}

export const MONITORED_LISTING_REPOSITORY = Symbol('MONITORED_LISTING_REPOSITORY');
