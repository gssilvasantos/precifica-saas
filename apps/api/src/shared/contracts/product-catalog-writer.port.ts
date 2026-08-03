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

  // Campos fiscais (02/08/2026). Ver a política de escrita em
  // catalog-sync-writer.service.ts: o sync PREENCHE lacuna, nunca sobrescreve
  // valor já existente no Kyneti.
  ncm: string | null;
  cest: string | null;
  gtin: string | null;
  fiscalOriginCode: number | null;

  // Variações (02/08/2026). Cada variação do Olist vira um Product PRÓPRIO,
  // não um atributo do pai — ela tem SKU, custo, estoque, GTIN, peso e
  // dimensões próprios, que é tudo que o motor de preço precisa. Importar só
  // o pai perderia justamente custo e estoque por cor.
  // Ver docs/olist-import-design.md, seção 5.1.
  //
  // `externalId` do PAI, não o id interno: quem chama é o sync, que só conhece
  // identificadores do ERP. A tradução para o id do Kyneti acontece do lado do
  // Catalog, dono da tabela.
  parentExternalId?: string | null;
  variantAttributes?: Record<string, string> | null;

  // Caminho da categoria NO ERP, como texto (`ROSTO > BASE > BASE LÍQUIDA`).
  //
  // Vai para `Product.internalCategory` (texto livre), NUNCA para a árvore
  // estruturada de ProductCategory: a categoria do Kyneti é organizada pelo
  // usuário e não precisa espelhar a do ERP. Aqui o sync só registra a origem;
  // virar árvore é ação explícita de migração.
  //
  // Também segue preenche-lacuna: quem já classificou o produto no Kyneti não
  // tem esse trabalho desfeito no próximo sync.
  erpCategoryPath?: string | null;
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
