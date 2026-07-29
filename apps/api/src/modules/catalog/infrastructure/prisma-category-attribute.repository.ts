import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CategoryAttributeRepository } from '../application/ports/category-attribute-repository.port';
import { CategoryAttribute, CategoryAttributeUpsertData } from '../domain/product-category';

@Injectable()
export class PrismaCategoryAttributeRepository implements CategoryAttributeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: CategoryAttributeUpsertData): Promise<CategoryAttribute> {
    const record = await this.prisma.categoryAttribute.upsert({
      where: { categoryId_attributeName: { categoryId: data.categoryId, attributeName: data.attributeName } },
      create: { ...data, extendToChildren: data.extendToChildren ?? false },
      update: { attributeValue: data.attributeValue, extendToChildren: data.extendToChildren ?? false },
    });
    return record as CategoryAttribute;
  }

  async findAllByCategory(tenantId: string, categoryId: string): Promise<CategoryAttribute[]> {
    const records = await this.prisma.categoryAttribute.findMany({ where: { tenantId, categoryId }, orderBy: { attributeName: 'asc' } });
    return records as CategoryAttribute[];
  }

  async findOne(tenantId: string, categoryId: string, attributeName: string): Promise<CategoryAttribute | null> {
    const record = await this.prisma.categoryAttribute.findFirst({ where: { tenantId, categoryId, attributeName } });
    return record as CategoryAttribute | null;
  }

  async remove(id: string): Promise<void> {
    await this.prisma.categoryAttribute.delete({ where: { id } });
  }
}
