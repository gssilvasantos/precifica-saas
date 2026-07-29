import { ProductCategory, ProductCategoryCreateData, ProductCategoryUpdateData, CategoryChainNode } from '../../domain/product-category';

export interface ProductCategoryRepository {
  create(data: ProductCategoryCreateData): Promise<ProductCategory>;
  findById(tenantId: string, id: string): Promise<ProductCategory | null>;
  findAllByTenant(tenantId: string): Promise<ProductCategory[]>;
  findChildren(tenantId: string, parentCategoryId: string): Promise<ProductCategory[]>;
  update(id: string, data: ProductCategoryUpdateData): Promise<ProductCategory>;
  remove(id: string): Promise<void>;
  // Ids de todos os ANCESTRAIS de uma categoria (não inclui ela mesma),
  // usado só para o gate canSetCategoryParent (detecção de ciclo).
  findAncestorIds(tenantId: string, categoryId: string): Promise<string[]>;
  // Cadeia completa (raiz -> folha), já com os CategoryAttribute de cada
  // nível — usada por resolveEffectiveAttributes (domain/product-category.ts).
  findChainWithAttributes(tenantId: string, categoryId: string): Promise<CategoryChainNode[]>;
}

export const PRODUCT_CATEGORY_REPOSITORY = Symbol('PRODUCT_CATEGORY_REPOSITORY');
