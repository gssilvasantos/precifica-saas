import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ProductCategoryRepository } from '../application/ports/product-category-repository.port';
import { ProductCategory, ProductCategoryCreateData, ProductCategoryUpdateData, CategoryChainNode } from '../domain/product-category';

@Injectable()
export class PrismaProductCategoryRepository implements ProductCategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: ProductCategoryCreateData): Promise<ProductCategory> {
    const record = await this.prisma.productCategory.create({ data });
    return record as ProductCategory;
  }

  async findById(tenantId: string, id: string): Promise<ProductCategory | null> {
    const record = await this.prisma.productCategory.findFirst({ where: { id, tenantId } });
    return record as ProductCategory | null;
  }

  async findAllByTenant(tenantId: string): Promise<ProductCategory[]> {
    const records = await this.prisma.productCategory.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    return records as ProductCategory[];
  }

  async findChildren(tenantId: string, parentCategoryId: string): Promise<ProductCategory[]> {
    const records = await this.prisma.productCategory.findMany({ where: { tenantId, parentCategoryId }, orderBy: { name: 'asc' } });
    return records as ProductCategory[];
  }

  async update(id: string, data: ProductCategoryUpdateData): Promise<ProductCategory> {
    const record = await this.prisma.productCategory.update({ where: { id }, data });
    return record as ProductCategory;
  }

  async remove(id: string): Promise<void> {
    await this.prisma.productCategory.delete({ where: { id } });
  }

  // Percorre parentCategoryId até a raiz — profundidade de categoria é
  // pequena na prática (poucos níveis), então N queries sequenciais é
  // aceitável no MVP; `visited` protege contra loop infinito caso um
  // ciclo seja introduzido por edição direta no banco (nunca pela
  // aplicação, que sempre passa por canSetCategoryParent).
  async findAncestorIds(tenantId: string, categoryId: string): Promise<string[]> {
    const ancestorIds: string[] = [];
    const visited = new Set<string>([categoryId]);
    let currentId: string | null = categoryId;

    while (currentId) {
      const node: { parentCategoryId: string | null } | null = await this.prisma.productCategory.findFirst({
        where: { id: currentId, tenantId },
        select: { parentCategoryId: true },
      });
      if (!node?.parentCategoryId || visited.has(node.parentCategoryId)) break;
      ancestorIds.push(node.parentCategoryId);
      visited.add(node.parentCategoryId);
      currentId = node.parentCategoryId;
    }

    return ancestorIds;
  }

  async findChainWithAttributes(tenantId: string, categoryId: string): Promise<CategoryChainNode[]> {
    const idsLeafToRoot: string[] = [categoryId];
    const visited = new Set<string>([categoryId]);
    let currentId: string | null = categoryId;

    while (currentId) {
      const node: { parentCategoryId: string | null } | null = await this.prisma.productCategory.findFirst({
        where: { id: currentId, tenantId },
        select: { parentCategoryId: true },
      });
      if (!node?.parentCategoryId || visited.has(node.parentCategoryId)) break;
      idsLeafToRoot.push(node.parentCategoryId);
      visited.add(node.parentCategoryId);
      currentId = node.parentCategoryId;
    }

    const idsRootToLeaf = idsLeafToRoot.reverse();
    const attributeRows = await this.prisma.categoryAttribute.findMany({
      where: { tenantId, categoryId: { in: idsRootToLeaf } },
    });

    return idsRootToLeaf.map((id) => ({
      id,
      attributes: attributeRows
        .filter((row) => row.categoryId === id)
        .map((row) => ({
          categoryId: row.categoryId,
          attributeName: row.attributeName,
          attributeValue: row.attributeValue,
          extendToChildren: row.extendToChildren,
        })),
    }));
  }
}
