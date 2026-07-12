import { apiClient } from '../../lib/api-client';

export interface ChannelListing {
  id: string;
  skuCode: string;
  channelCode: string;
  externalId: string;
  currentPrice: number | null;
  url: string | null;
  lastSyncedAt: string;
}

export async function fetchChannelListings(): Promise<ChannelListing[]> {
  const { data } = await apiClient.get<ChannelListing[]>('/erp-integration/channel-listings');
  return data;
}
