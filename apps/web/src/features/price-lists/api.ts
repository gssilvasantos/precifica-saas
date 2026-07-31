import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/catalog/domain/price-list.entity.ts —
// mesmo racional de duplicação intencional do resto do frontend.
export interface PriceList {
  id: string;
  tenantId: string;
  name: string;
  adjustmentPct: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PriceListInput {
  name: string;
  adjustmentPct: number;
}

export interface PriceListException {
  id: string;
  tenantId: string;
  priceListId: string;
  productId: string;
  overridePrice: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchPriceLists(): Promise<PriceList[]> {
  const { data } = await apiClient.get<PriceList[]>('/price-lists');
  return data;
}

export async function createPriceList(input: PriceListInput): Promise<PriceList> {
  const { data } = await apiClient.post<PriceList>('/price-lists', input);
  return data;
}

export async function updatePriceList(id: string, input: Partial<PriceListInput>): Promise<PriceList> {
  const { data } = await apiClient.patch<PriceList>(`/price-lists/${id}`, input);
  return data;
}

export async function deactivatePriceList(id: string): Promise<PriceList> {
  const { data } = await apiClient.delete<PriceList>(`/price-lists/${id}`);
  return data;
}

export async function fetchPriceListExceptions(priceListId: string): Promise<PriceListException[]> {
  const { data } = await apiClient.get<PriceListException[]>(`/price-lists/${priceListId}/exceptions`);
  return data;
}

export async function setPriceListException(priceListId: string, productId: string, overridePrice: number): Promise<PriceListException> {
  const { data } = await apiClient.post<PriceListException>(`/price-lists/${priceListId}/exceptions`, { productId, overridePrice });
  return data;
}

export async function removePriceListException(priceListId: string, productId: string): Promise<void> {
  await apiClient.delete(`/price-lists/${priceListId}/exceptions/${productId}`);
}

export async function resolvePriceListPrice(priceListId: string, productId: string, basePrice: number): Promise<number> {
  const { data } = await apiClient.get<number>(`/price-lists/${priceListId}/resolve-price/${productId}`, {
    params: { basePrice },
  });
  return data;
}
