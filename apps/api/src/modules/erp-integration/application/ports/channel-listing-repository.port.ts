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
}

export const CHANNEL_LISTING_REPOSITORY = Symbol('CHANNEL_LISTING_REPOSITORY');
