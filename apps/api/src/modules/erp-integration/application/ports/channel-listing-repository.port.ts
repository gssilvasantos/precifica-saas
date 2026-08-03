export interface ChannelListingRecord {
  id: string;
  tenantId: string;
  skuCode: string;
  channelCode: string;
  externalId: string;
  currentPrice: number | null;
  url: string | null;
  lastSyncedAt: Date;
}

export interface ChannelListingUpsertData {
  tenantId: string;
  skuCode: string;
  channelCode: string;
  externalId: string;
  currentPrice: number | null;
  url: string | null;
}

export interface ChannelListingRepository {
  upsert(data: ChannelListingUpsertData): Promise<ChannelListingRecord>;
  findBySku(tenantId: string, channelCode: string, skuCode: string): Promise<ChannelListingRecord | null>;
  findAllByTenant(tenantId: string): Promise<ChannelListingRecord[]>;
  // Lookup em lote na direção anúncio -> SKU (01/08/2026, custo de Ads por
  // item). Em lote porque o consumidor resolve dezenas de anúncios ao montar
  // um DRE — um a um seriam N queries por relatório.
  findSkusByExternalIds(
    tenantId: string,
    channelCode: string,
    externalIds: string[],
  ): Promise<{ externalId: string; skuCode: string }[]>;
}

export const CHANNEL_LISTING_REPOSITORY = Symbol('CHANNEL_LISTING_REPOSITORY');
