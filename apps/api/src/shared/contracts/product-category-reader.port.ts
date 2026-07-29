// Porta de LEITURA exposta pelo Catalog para a árvore de categoria (Fase 4,
// benchmark Tiny ERP, Publicar anúncio novo em marketplace) — consumida pelo
// módulo marketplace-publishing sem depender de PRODUCT_CATEGORY_REPOSITORY
// nem da classe concreta ProductCategoryService, mesma disciplina de Ports
// & Adapters do resto da plataforma.
export interface ProductCategorySummary {
  id: string;
  name: string;
  parentCategoryId: string | null;
}

export interface ProductCategoryReader {
  findById(tenantId: string, categoryId: string): Promise<ProductCategorySummary | null>;
  // Atributos já resolvidos (herança aplicada) — ver
  // domain/product-category.ts, resolveEffectiveAttributes, no módulo
  // catalog. O chamador nunca monta a cadeia de categoria sozinho.
  resolveEffectiveAttributes(tenantId: string, categoryId: string): Promise<Record<string, string>>;
}

export const PRODUCT_CATEGORY_READER = Symbol('PRODUCT_CATEGORY_READER');
