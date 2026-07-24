// Porta de LEITURA exposta pelo Catalog — irmã do ProductCatalogWriter, mas
// no sentido oposto. Existe porque o Pricing Intelligence (primeira fatia:
// simulador de margem da Nuvemshop) precisa do costPrice de um produto sem
// depender da tabela Product nem do PRODUCT_REPOSITORY interno do Catalog —
// mesma disciplina de Ports & Adapters do resto da plataforma.
//
// desiredMarginPct/minimumMarginPct entraram junto com o PricingStrategist
// (módulo pricing-intelligence) — é o piso/alvo de margem por SKU que o
// estrategista precisa para respeitar a "regra de ouro" (nunca furar a
// margem mínima). Extensão aditiva: quem já consumia só costPrice (o
// simulador de margem da Nuvemshop) não quebra.
export interface ProductCatalogSummary {
  productId: string;
  skuCode: string;
  name: string;
  // custo EFETIVO (o que o PricingStrategist deve usar): productCostPrice +
  // (packagingCostPrice ?? 0). Packaging Intel — ver
  // docs/pricing-intelligence-architecture.md, seção 9. Mantido como
  // `costPrice` (não renomeado) para não quebrar quem já consumia este
  // campo antes de Packaging existir; o breakdown abaixo é aditivo, só
  // para transparência/depuração (ex.: mostrar no futuro botão "Aplicar
  // Preço Agora" de onde veio o custo).
  costPrice: number;
  productCostPrice: number;
  packagingCostPrice: number | null;
  desiredMarginPct: number;
  minimumMarginPct: number;
  // Modo operação do PricingStrategist (Product.autoRepricingEnabled) — ver
  // docs/pricing-intelligence-architecture.md, seção 7. Também aditivo.
  autoRepricingEnabled: boolean;
  // Sprint 26 (Motor de Margem de Promoções) — packagingId cru (não só o
  // custo já resolvido) e isKit, para o LogisticsCostReaderService decidir
  // se packagingId aponta para uma embalagem individual ou uma "Embalagem
  // de Agrupamento" de kit. Aditivo, mesmo racional do resto do arquivo.
  packagingId: string | null;
  isKit: boolean;
  // Política de Preço Mínimo Anunciado (MAP, Product.mapPrice) — piso
  // definido pelo fornecedor/marca, não calculado a partir de custo/margem
  // como os campos acima. null = sem restrição MAP para este SKU. Ver
  // domain/pricing-strategist.ts (PricingContext.mapPrice/validatePriceAgainstMap).
  mapPrice: number | null;
}

export interface ProductCatalogReader {
  findBySku(tenantId: string, skuCode: string): Promise<ProductCatalogSummary | null>;
}
