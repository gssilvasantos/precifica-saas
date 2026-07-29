import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ProductWarehouseLocationRepository } from '../application/ports/product-warehouse-location-repository.port';
import { ProductWarehouseLocation, ProductWarehouseLocationUpsertData } from '../domain/product-warehouse-location.entity';

@Injectable()
export class PrismaProductWarehouseLocationRepository implements ProductWarehouseLocationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: ProductWarehouseLocationUpsertData): Promise<ProductWarehouseLocation> {
    const record = await this.prisma.productWarehouseLocation.upsert({
      where: { tenantId_warehouseId_skuCode: { tenantId: data.tenantId, warehouseId: data.warehouseId, skuCode: data.skuCode } },
      create: { tenantId: data.tenantId, warehouseId: data.warehouseId, skuCode: data.skuCode, location: data.location },
      update: { location: data.location },
    });
    return this.toDomain(record);
  }

  async findByWarehouse(tenantId: string, warehouseId: string): Promise<ProductWarehouseLocation[]> {
    const records = await this.prisma.productWarehouseLocation.findMany({
      where: { tenantId, warehouseId },
      orderBy: { skuCode: 'asc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async findOne(tenantId: string, warehouseId: string, skuCode: string): Promise<ProductWarehouseLocation | null> {
    const record = await this.prisma.productWarehouseLocation.findUnique({
      where: { tenantId_warehouseId_skuCode: { tenantId, warehouseId, skuCode } },
    });
    return record ? this.toDomain(record) : null;
  }

  private toDomain(record: {
    id: string;
    tenantId: string;
    warehouseId: string;
    skuCode: string;
    location: string;
    createdAt: Date;
    updatedAt: Date;
  }): ProductWarehouseLocation {
    return { ...record };
  }
}
