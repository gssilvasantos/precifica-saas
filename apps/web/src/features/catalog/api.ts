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
  // Produtos-Lotes (Projeto Estruturante 2) — precisa ser true antes de
  // cadastrar qualquer lote para este produto (ver ProductLotService.create).
  controlaLote: boolean;
  // Árvore de categoria (Fase 4) — id de catalog.ProductCategory, usado para
  // publicar anúncio em marketplace (resolve atributos herdados + mapeamento
  // de categoria do canal). null = produto ainda sem categoria definida.
  categoryId: string | null;
  weightKg: number;
  packagingWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;

  // Campos fiscais (NCM, GTIN, origem, CEST) — pré-requisito da emissão de
  // NF-e e da publicação de anúncio, e chave da classificação tributária por
  // produto (substituição tributária e monofásico são definidos pelo NCM, não
  // pelo SKU).
  //
  // O backend guarda e devolve estes campos desde o benchmark Tiny/Bling, e já
  // os replica do produto pai para as variações geradas
  // (catalog/application/products.service.ts). Até 02/08/2026 o frontend não
  // os declarava nem exibia — existiam e eram invisíveis.
  ncm: string | null;
  gtin: string | null;
  fiscalOriginCode: number | null;
  cest: string | null;
}

export interface ProductWriteInput {
  skuCode: string;
  name: string;
  internalCategory?: string | null;
  costPrice: number;
  desiredMarginPct: number;
  minimumMarginPct: number;
  weightKg: number;
  packagingWeightKg?: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  ncm?: string | null;
  gtin?: string | null;
  fiscalOriginCode?: number | null;
  cest?: string | null;
}

export async function createProduct(input: ProductWriteInput): Promise<Product> {
  const { data } = await apiClient.post<Product>('/products', input);
  return data;
}

// PATCH parcial: manda só o que mudou. Enviar o objeto inteiro sobrescreveria
// campos que o ERP é dono (ver product-ownership-rules.ts no backend).
export async function updateProduct(id: string, input: Partial<ProductWriteInput>): Promise<Product> {
  const { data } = await apiClient.patch<Product>(`/products/${id}`, input);
  return data;
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

// Produtos-Lotes — liga o controle de lote para este produto (pré-requisito
// para cadastrar lotes, ver features/product-lots/api.ts).
export async function updateProductControlaLote(id: string, controlaLote: boolean): Promise<Product> {
  const { data } = await apiClient.patch<Product>(`/products/${id}`, { controlaLote });
  return data;
}

// Fase 4 (Publicar Anúncio Novo) — vincula o produto a uma categoria interna
// (catalog.ProductCategory), pré-requisito para publicar em marketplace (ver
// features/marketplace-publishing/api.ts). Aceita null para desvincular.
export async function updateProductCategory(id: string, categoryId: string | null): Promise<Product> {
  const { data } = await apiClient.patch<Product>(`/products/${id}`, { categoryId });
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
