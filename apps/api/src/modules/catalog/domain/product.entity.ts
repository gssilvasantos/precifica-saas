// Fonte do produto — MANUAL (cadastro no Precifica, tudo editável) ou
// ERP_OLIST (espelhado, ver domain/product-ownership-rules.ts para quais
// campos ficam travados). Etapa 5 — docs/erp-integration-architecture.md, seção 2.
export type ProductSourceSystem = 'MANUAL' | 'ERP_OLIST';

export interface Product {
  id: string;
  tenantId: string;
  skuCode: string;
  name: string;
  internalCategory: string | null;
  supplierId: string | null;
  taxProfileId: string | null;
  packagingId: string | null;
  // Sprint 26 (Motor de Margem de Promoções) — quando true, packagingId
  // acima significa "Embalagem de Agrupamento" deste kit (Packaging.purpose
  // = GROUPING), não embalagem individual. Ver prisma/schema.prisma,
  // model Product, para o racional completo.
  isKit: boolean;
  costPrice: number;
  desiredMarginPct: number;
  minimumMarginPct: number;
  autoRepricingEnabled: boolean;
  // Política de Preço Mínimo Anunciado (MAP) — ver prisma/schema.prisma,
  // model Product, para o racional completo. null = sem restrição MAP.
  mapPrice: number | null;
  weightKg: number;
  packagingWeightKg: number;
  packedWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  cubicWeightKg: number;
  shippingWeightKg: number;
  stockQuantity: number;
  erpSalePrice: number | null;
  photoUrls: string[];
  sourceSystem: ProductSourceSystem;
  externalId: string | null;
  lastSyncedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Dados de criação: packedWeightKg/cubicWeightKg/shippingWeightKg chegam já
// calculados pelo ProductsService (que os obtém via a porta
// ShippingWeightCalculator do Logistics Intelligence) — o repositório só persiste.
// Campos de proveniência/estoque/ERP são opcionais: no fluxo manual (a
// grande maioria) o Prisma aplica os defaults do schema (stockQuantity=0,
// sourceSystem=MANUAL, photoUrls=[]); só o CatalogSyncWriterService (Etapa 5)
// os preenche de fato.
export interface ProductCreateData {
  tenantId: string;
  skuCode: string;
  name: string;
  internalCategory?: string;
  supplierId?: string;
  taxProfileId?: string;
  packagingId?: string;
  isKit?: boolean;
  costPrice: number;
  desiredMarginPct: number;
  minimumMarginPct: number;
  autoRepricingEnabled?: boolean;
  // undefined = não informado neste create (persiste como null, sem
  // restrição MAP); null explícito é o mesmo efeito — ver ProductsService.update
  // para o caso de UPDATE, onde a distinção undefined/null importa de verdade
  // (undefined = "não mexer", null = "limpar o MAP existente").
  mapPrice?: number | null;
  weightKg: number;
  packagingWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  packedWeightKg: number;
  cubicWeightKg: number;
  shippingWeightKg: number;
  stockQuantity?: number;
  erpSalePrice?: number | null;
  photoUrls?: string[];
  sourceSystem?: ProductSourceSystem;
  externalId?: string;
  lastSyncedAt?: Date;
}
