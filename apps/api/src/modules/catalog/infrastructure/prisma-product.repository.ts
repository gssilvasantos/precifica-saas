import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ProductRepository, ProductUpdateData } from '../application/ports/product-repository.port';
import { Product, ProductCreateData, ProductSourceSystem } from '../domain/product.entity';

@Injectable()
export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: ProductCreateData): Promise<Product> {
    // sourceSystem é union type de string no domínio e enum nominal no
    // client do Prisma — mesmo valor, cast necessário (mesmo padrão do
    // marketplace-intelligence, ver prisma-marketplace-rule.repository.ts).
    const record = await this.prisma.product.create({ data: data as never });
    return this.toDomain(record);
  }

  async findAllActive(tenantId: string): Promise<Product[]> {
    const records = await this.prisma.product.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
    return records.map((record) => this.toDomain(record));
  }

  async findById(tenantId: string, id: string): Promise<Product | null> {
    const record = await this.prisma.product.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record) : null;
  }

  async findByExternalId(
    tenantId: string,
    sourceSystem: ProductSourceSystem,
    externalId: string,
  ): Promise<Product | null> {
    const record = await this.prisma.product.findFirst({
      where: { tenantId, sourceSystem: sourceSystem as never, externalId },
    });
    return record ? this.toDomain(record) : null;
  }

  async update(id: string, data: ProductUpdateData): Promise<Product> {
    const record = await this.prisma.product.update({ where: { id }, data: data as never });
    return this.toDomain(record);
  }

  async deactivate(id: string): Promise<Product> {
    const record = await this.prisma.product.update({ where: { id }, data: { isActive: false } });
    return this.toDomain(record);
  }

  // Converte o Decimal do Prisma para number na borda — o domínio não precisa
  // saber que a persistência usa um tipo decimal de banco.
  private toDomain(
    record: Record<string, unknown> & {
      costPrice: { toString(): string };
      erpSalePrice: { toString(): string } | null;
      mapPrice: { toString(): string } | null;
    },
  ): Product {
    return {
      ...record,
      costPrice: Number(record.costPrice),
      erpSalePrice: record.erpSalePrice !== null ? Number(record.erpSalePrice) : null,
      mapPrice: record.mapPrice !== null ? Number(record.mapPrice) : null,
    } as Product;
  }
}
