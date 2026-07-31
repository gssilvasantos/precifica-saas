import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/competition-intelligence/application/ports/*.port.ts
// — mesmo racional de duplicação intencional do resto do frontend.
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

export interface CreateMonitoredListingInput {
  skuCode: string;
  competitorLabel: string;
  targetRef: string;
  radarCode: string;
  channelCode?: string;
}

export type BuyBoxStatus = 'WINNING' | 'LOSING' | 'UNKNOWN';

export interface CompetitiveOpportunity {
  tenantId: string;
  skuCode: string;
  bestCompetitorPrice: number;
  bestCompetitorLabel: string;
  ourPrice: number | null;
  channelCode: string | null;
  priceGapPct: number;
  buyBoxStatus: BuyBoxStatus;
  rank: number | null;
  detectedAt: string;
}

export async function fetchCompetitiveOpportunities(): Promise<CompetitiveOpportunity[]> {
  const { data } = await apiClient.get<CompetitiveOpportunity[]>('/competition-intelligence/opportunities');
  return data;
}

export async function fetchMonitoredListings(): Promise<MonitoredListing[]> {
  const { data } = await apiClient.get<MonitoredListing[]>('/competition-intelligence/monitored-listings');
  return data;
}

export async function createMonitoredListing(input: CreateMonitoredListingInput): Promise<MonitoredListing> {
  const { data } = await apiClient.post<MonitoredListing>('/competition-intelligence/monitored-listings', input);
  return data;
}

export async function deactivateMonitoredListing(id: string): Promise<MonitoredListing> {
  const { data } = await apiClient.patch<MonitoredListing>(`/competition-intelligence/monitored-listings/${id}/deactivate`, {});
  return data;
}

export async function runCompetitionMonitorNow(): Promise<{ triggered: boolean }> {
  const { data } = await apiClient.post<{ triggered: boolean }>('/competition-intelligence/run-now', {});
  return data;
}
