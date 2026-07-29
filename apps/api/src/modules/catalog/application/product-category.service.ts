import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRODUCT_CATEGORY_REPOSITORY, ProductCategoryRepository } from './ports/product-category-repository.port';
import { CATEGORY_ATTRIBUTE_REPOSITORY, CategoryAttributeRepository } from './ports/category-attribute-repository.port';
import {
  ProductCategory,
  ProductCategoryCreateData,
  ProductCategoryUpdateData,
  CategoryAttribute,
  canSetCategoryParent,
  resolveEffectiveAttributes,
} from '../domain/product-category';
import { ProductCategoryReader, ProductCategorySummary } from '../../../shared/contracts/product-category-reader.port';

export interface SetCategoryAttributeInput {
  attributeName: string;
  attributeValue: string;
  extendToChildren?: boolean;
}

// CRUD da árvore de categoria + atributos por categoria (Fase 4, benchmark
// Tiny ERP) — espelha "Categorias dos Produtos" do Tiny/Olist. Implementa
// também ProductCategoryReader (mesma disciplina de CatalogReaderService/
// PackagingsService: uma classe expõe a porta cross-módulo além do seu CRUD
// interno, reaproveitando o mesmo repositório).
@Injectable()
export class ProductCategoryService implements ProductCategoryReader {
  constructor(
    @Inject(PRODUCT_CATEGORY_REPOSITORY) private readonly categories: ProductCategoryRepository,
    @Inject(CATEGORY_ATTRIBUTE_REPOSITORY) private readonly attributes: CategoryAttributeRepository,
  ) {}

  async create(tenantId: string, input: Omit<ProductCategoryCreateData, 'tenantId'>): Promise<ProductCategory> {
    if (!input.name || !input.name.trim()) {
      throw new BadRequestException('name é obrigatório.');
    }
    if (input.parentCategoryId) {
      await this.requireOne(tenantId, input.parentCategoryId);
    }
    return this.categories.create({ tenantId, ...input });
  }

  findAll(tenantId: string): Promise<ProductCategory[]> {
    return this.categories.findAllByTenant(tenantId);
  }

  findChildren(tenantId: string, parentCategoryId: string): Promise<ProductCategory[]> {
    return this.categories.findChildren(tenantId, parentCategoryId);
  }

  async findOne(tenantId: string, id: string): Promise<ProductCategory> {
    return this.requireOne(tenantId, id);
  }

  async update(tenantId: string, id: string, input: ProductCategoryUpdateData): Promise<ProductCategory> {
    await this.requireOne(tenantId, id);

    if (input.parentCategoryId) {
      await this.requireOne(tenantId, input.parentCategoryId);
      const ancestorIdsOfCandidateParent = await this.categories.findAncestorIds(tenantId, input.parentCategoryId);
      const gate = canSetCategoryParent({
        categoryId: id,
        candidateParentId: input.parentCategoryId,
        ancestorIdsOfCandidateParent,
      });
      if (!gate.ok) {
        throw new BadRequestException(gate.reason);
      }
    }

    return this.categories.update(id, input);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.requireOne(tenantId, id);
    const children = await this.categories.findChildren(tenantId, id);
    if (children.length > 0) {
      throw new BadRequestException('Esta categoria tem subcategorias vinculadas — remova ou reatribua-as antes.');
    }
    await this.categories.remove(id);
  }

  // --- Atributos por categoria ("informar atributos por categoria" do Tiny/Olist) ---

  async setAttribute(tenantId: string, categoryId: string, input: SetCategoryAttributeInput): Promise<CategoryAttribute> {
    await this.requireOne(tenantId, categoryId);
    if (!input.attributeName || !input.attributeName.trim()) {
      throw new BadRequestException('attributeName é obrigatório.');
    }
    if (!input.attributeValue || !input.attributeValue.trim()) {
      throw new BadRequestException('attributeValue é obrigatório.');
    }
    return this.attributes.upsert({
      tenantId,
      categoryId,
      attributeName: input.attributeName.trim(),
      attributeValue: input.attributeValue.trim(),
      extendToChildren: input.extendToChildren ?? false,
    });
  }

  async listAttributes(tenantId: string, categoryId: string): Promise<CategoryAttribute[]> {
    await this.requireOne(tenantId, categoryId);
    return this.attributes.findAllByCategory(tenantId, categoryId);
  }

  async removeAttribute(tenantId: string, categoryId: string, attributeName: string): Promise<void> {
    await this.requireOne(tenantId, categoryId);
    const attribute = await this.attributes.findOne(tenantId, categoryId, attributeName);
    if (!attribute) {
      throw new NotFoundException(`Atributo "${attributeName}" não encontrado nesta categoria.`);
    }
    await this.attributes.remove(attribute.id);
  }

  // --- ProductCategoryReader (porta cross-módulo, consumida pelo marketplace-publishing) ---

  async findById(tenantId: string, categoryId: string): Promise<ProductCategorySummary | null> {
    const category = await this.categories.findById(tenantId, categoryId);
    if (!category) return null;
    return { id: category.id, name: category.name, parentCategoryId: category.parentCategoryId };
  }

  async resolveEffectiveAttributes(tenantId: string, categoryId: string): Promise<Record<string, string>> {
    const chain = await this.categories.findChainWithAttributes(tenantId, categoryId);
    return resolveEffectiveAttributes(chain);
  }

  private async requireOne(tenantId: string, id: string): Promise<ProductCategory> {
    const category = await this.categories.findById(tenantId, id);
    if (!category) {
      throw new NotFoundException(`Categoria ${id} não encontrada.`);
    }
    return category;
  }
}
