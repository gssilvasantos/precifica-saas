import { CategoryAttribute, CategoryAttributeUpsertData } from '../../domain/product-category';

export interface CategoryAttributeRepository {
  // Upsert por (categoryId, attributeName) — reenviar o mesmo nome apenas
  // atualiza o valor/extendToChildren, nunca duplica (mesmo racional de
  // PriceListException.setException).
  upsert(data: CategoryAttributeUpsertData): Promise<CategoryAttribute>;
  findAllByCategory(tenantId: string, categoryId: string): Promise<CategoryAttribute[]>;
  findOne(tenantId: string, categoryId: string, attributeName: string): Promise<CategoryAttribute | null>;
  remove(id: string): Promise<void>;
}

export const CATEGORY_ATTRIBUTE_REPOSITORY = Symbol('CATEGORY_ATTRIBUTE_REPOSITORY');
