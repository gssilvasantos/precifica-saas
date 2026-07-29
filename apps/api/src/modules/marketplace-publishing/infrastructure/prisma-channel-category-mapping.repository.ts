import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ChannelCategoryMapping,
  ChannelCategoryMappingRepository,
  ChannelCategoryMappingUpsertData,
} from '../application/ports/channel-category-mapping-repository.port';

type PrismaChannelCategoryMappingRecord = {
  id: string;
  tenantId: string;
  categoryId: string;
  marketplaceCode: string;
  externalCategoryId: string;
  externalCategoryName: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaChannelCategoryMappingRepository implements ChannelCategoryMappingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: ChannelCategoryMappingUpsertData): Promise<ChannelCategoryMapping> {
    const record = await this.prisma.channelCategoryMapping.upsert({
      where: {
        tenantId_categoryId_marketplaceCode: {
          tenantId: data.tenantId,
          categoryId: data.categoryId,
          marketplaceCode: data.marketplaceCode,
        },
      },
      create: data,
      update: {
        externalCategoryId: data.externalCategoryId,
        externalCategoryName: data.externalCategoryName,
      },
    });
    return this.toDomain(record);
  }

  async findOne(tenantId: string, categoryId: string, marketplaceCode: string): Promise<ChannelCategoryMapping | null> {
    const record = await this.prisma.channelCategoryMapping.findUnique({
      where: { tenantId_categoryId_marketplaceCode: { tenantId, categoryId, marketplaceCode } },
    });
    return record ? this.toDomain(record) : null;
  }

  async findAllByCategory(tenantId: string, categoryId: string): Promise<ChannelCategoryMapping[]> {
    const records = await this.prisma.channelCategoryMapping.findMany({
      where: { tenantId, categoryId },
      orderBy: { marketplaceCode: 'asc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.channelCategoryMapping.deleteMany({ where: { id, tenantId } });
  }

  private toDomain(record: PrismaChannelCategoryMappingRecord): ChannelCategoryMapping {
    return { ...record };
  }
}
