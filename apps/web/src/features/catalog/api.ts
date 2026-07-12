import { apiClient } from '../../lib/api-client';

export interface Product {
  id: string;
  skuCode: string;
  name: string;
  internalCategory: string | null;
  costPrice: number;
  desiredMarginPct: number;
  minimumMarginPct: number;
  stockQuantity: number;
  erpSalePrice: number | null;
  photoUrls: string[];
  sourceSystem: 'MANUAL' | 'ERP_OLIST';
  isActive: boolean;
}

export async function fetchProducts(): Promise<Product[]> {
  const { data } = await apiClient.get<Product[]>('/products');
  return data;
}
