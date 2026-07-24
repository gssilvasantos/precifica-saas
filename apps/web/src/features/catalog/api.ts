import { apiClient } from '../../lib/api-client';

export interface Product {
  id: string;
  skuCode: string;
  name: string;
  internalCategory: string | null;
  costPrice: number;
  desiredMarginPct: number;
  minimumMarginPct: number;
  // Política de Preço Mínimo Anunciado (MAP) — piso definido pelo
  // fornecedor/marca, ver docs/map-price-governance-architecture.md. null =
  // sem restrição MAP para este SKU (não é o mesmo que 0).
  mapPrice: number | null;
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

// Só mapPrice por enquanto — este é o único campo que a UI de Governança
// MAP edita; PATCH /products/:id aceita qualquer subconjunto de campos
// (PartialType(CreateProductDto) no backend), mas o cliente só expõe o que
// a tela de fato usa, mesma disciplina do resto do frontend.
export async function updateProductMapPrice(id: string, mapPrice: number | null): Promise<Product> {
  const { data } = await apiClient.patch<Product>(`/products/${id}`, { mapPrice });
  return data;
}

// Trilha de auditoria de campos de governança (hoje só mapPrice) — espelha
// apps/api/src/modules/catalog/application/ports/product-audit-log-repository.port.ts.
export type ProductAuditSource = 'MANUAL' | 'BULK_IMPORT';

export interface ProductAuditLogEntry {
  id: string;
  tenantId: string;
  productId: string;
  skuCode: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedByUserId: string;
  source: ProductAuditSource;
  changedAt: string;
}

export async function fetchProductAuditLog(productId: string): Promise<ProductAuditLogEntry[]> {
  const { data } = await apiClient.get<ProductAuditLogEntry[]>(`/products/${productId}/audit-log`);
  return data;
}

// Importação em massa de MAP via CSV (sku_code,map_price) — o cliente lê o
// arquivo local (input[type=file] + FileReader) e manda o texto cru no
// corpo, mesma convenção de ImportSettlementDto (financial-intelligence):
// este projeto evita multipart/FileInterceptor de propósito.
export interface MapPriceImportError {
  rowNumber: number;
  message: string;
}

export interface BulkMapPriceImportSummary {
  totalRows: number;
  updated: number;
  unchanged: number;
  errors: MapPriceImportError[];
}

export async function bulkImportMapPrice(fileContent: string): Promise<BulkMapPriceImportSummary> {
  const { data } = await apiClient.post<BulkMapPriceImportSummary>('/products/bulk-import/map-price', { fileContent });
  return data;
}
