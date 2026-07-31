import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/catalog/domain/product-category.ts +
// apps/api/src/modules/marketplace-publishing/domain/* — mesmo racional de
// duplicação intencional do resto do frontend.
export interface ProductCategory {
  id: string;
  tenantId: string;
  name: string;
  parentCategoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryAttribute {
  id: string;
  tenantId: string;
  categoryId: string;
  attributeName: string;
  attributeValue: string;
  extendToChildren: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalCategoryCandidate {
  externalCategoryId: string;
  name: string;
}

export interface ExternalCategoryAttribute {
  name: string;
  required: boolean;
}

export interface ChannelCategoryMapping {
  id: string;
  tenantId: string;
  categoryId: string;
  marketplaceCode: string;
  externalCategoryId: string;
  externalCategoryName: string;
  createdAt: string;
  updatedAt: string;
}

export type ListingPublicationStatus = 'PENDENTE' | 'PUBLICADO' | 'ERRO';

export interface ListingPublication {
  id: string;
  tenantId: string;
  productId: string;
  skuCode: string;
  marketplaceCode: string;
  status: ListingPublicationStatus;
  externalListingId: string | null;
  requestPayload: unknown;
  errorMessage: string | null;
  requestedAt: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Categorias internas (árvore) ---

export async function fetchProductCategories(parentId?: string): Promise<ProductCategory[]> {
  const { data } = await apiClient.get<ProductCategory[]>('/product-categories', { params: parentId ? { parentId } : undefined });
  return data;
}

export async function fetchProductCategory(id: string): Promise<ProductCategory> {
  const { data } = await apiClient.get<ProductCategory>(`/product-categories/${id}`);
  return data;
}

export async function createProductCategory(input: { name: string; parentCategoryId?: string }): Promise<ProductCategory> {
  const { data } = await apiClient.post<ProductCategory>('/product-categories', input);
  return data;
}

export async function updateProductCategoryNode(id: string, input: { name?: string; parentCategoryId?: string }): Promise<ProductCategory> {
  const { data } = await apiClient.patch<ProductCategory>(`/product-categories/${id}`, input);
  return data;
}

export async function removeProductCategory(id: string): Promise<void> {
  await apiClient.delete(`/product-categories/${id}`);
}

export async function fetchCategoryAttributes(categoryId: string): Promise<CategoryAttribute[]> {
  const { data } = await apiClient.get<CategoryAttribute[]>(`/product-categories/${categoryId}/attributes`);
  return data;
}

export async function setCategoryAttribute(
  categoryId: string,
  input: { attributeName: string; attributeValue: string; extendToChildren?: boolean },
): Promise<CategoryAttribute> {
  const { data } = await apiClient.post<CategoryAttribute>(`/product-categories/${categoryId}/attributes`, input);
  return data;
}

export async function removeCategoryAttribute(categoryId: string, attributeName: string): Promise<void> {
  await apiClient.delete(`/product-categories/${categoryId}/attributes/${encodeURIComponent(attributeName)}`);
}

// --- Mapeamento categoria interna <-> categoria do canal ---

export async function searchExternalCategories(marketplaceCode: string, query: string): Promise<ExternalCategoryCandidate[]> {
  const { data } = await apiClient.get<ExternalCategoryCandidate[]>('/marketplace-publishing/category-mappings/search', {
    params: { marketplaceCode, query },
  });
  return data;
}

export async function fetchExternalCategoryAttributes(marketplaceCode: string, externalCategoryId: string): Promise<ExternalCategoryAttribute[]> {
  const { data } = await apiClient.get<ExternalCategoryAttribute[]>('/marketplace-publishing/category-mappings/attributes', {
    params: { marketplaceCode, externalCategoryId },
  });
  return data;
}

export async function fetchCategoryMappings(categoryId: string): Promise<ChannelCategoryMapping[]> {
  const { data } = await apiClient.get<ChannelCategoryMapping[]>('/marketplace-publishing/category-mappings', { params: { categoryId } });
  return data;
}

export async function setCategoryMapping(input: {
  categoryId: string;
  marketplaceCode: string;
  externalCategoryId: string;
  externalCategoryName: string;
}): Promise<ChannelCategoryMapping> {
  const { data } = await apiClient.post<ChannelCategoryMapping>('/marketplace-publishing/category-mappings', input);
  return data;
}

export async function removeCategoryMapping(id: string): Promise<void> {
  await apiClient.delete(`/marketplace-publishing/category-mappings/${id}`);
}

// --- Publicação de anúncio ---

export async function publishListing(input: {
  skuCode: string;
  marketplaceCode: string;
  price: number;
  availableQuantity: number;
  currency?: string;
  overrideAttributes?: Record<string, string>;
}): Promise<ListingPublication> {
  const { data } = await apiClient.post<ListingPublication>('/marketplace-publishing/listings/publish', input);
  return data;
}

export async function fetchListingPublications(productId: string): Promise<ListingPublication[]> {
  const { data } = await apiClient.get<ListingPublication[]>('/marketplace-publishing/listings', { params: { productId } });
  return data;
}
