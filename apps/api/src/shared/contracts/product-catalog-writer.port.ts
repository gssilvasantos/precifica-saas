// Porta exposta pelo Catalog, consumida pelo erp-integration — espelho
// exato do ShippingWeightCalculator (lá o Catalog consome; aqui o Catalog
// expõe). Mesmo princípio de Ports & Adapters, direção invertida.
// Ver docs/erp-integration-architecture.md, seção 3.
export interface ProductCatalogWriteData {
  tenantId: string;
  skuCode: string;
  name: string;
  costPrice: number;
  stockQuantity: number;
  weightKg: number;
  packagingWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  photoUrls: string[];
  erpSalePrice: number | null;
  sourceSystem: 'ERP_OLIST';
  externalId: string;
}

export interface ProductCatalogWriter {
  // Busca por (tenantId, sourceSystem, externalId). Se não existe, cria —
  // com desiredMarginPct/minimumMarginPct em um default configurável
  // (CatalogSettings), já que o ERP não tem esse conceito. Se existe,
  // atualiza só os campos espelhados, preservando margem/perfil
  // fiscal/categoria interna já configurados pelo tenant. Recalcula peso
  // cubado via ShippingWeightCalculator, igual ao fluxo manual.
  upsertFromExternalSource(data: ProductCatalogWriteData): Promise<{ productId: string; changed: boolean }>;
}
