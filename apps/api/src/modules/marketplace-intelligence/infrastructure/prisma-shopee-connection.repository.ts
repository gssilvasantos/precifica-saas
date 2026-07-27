import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ShopeeConnectionRecord,
  ShopeeConnectionRepository,
  ShopeeConnectionUpsertData,
} from '../application/ports/shopee-connection-repository.port';

@Injectable()
export class PrismaShopeeConnectionRepository implements ShopeeConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByTenant(tenantId: string): Promise<ShopeeConnectionRecord | null> {
    return this.prisma.shopeeConnection.findUnique({ where: { tenantId } });
  }

  findAllActive(): Promise<ShopeeConnectionRecord[]> {
    return this.prisma.shopeeConnection.findMany({ where: { isActive: true } });
  }

  upsert(tenantId: string, data: ShopeeConnectionUpsertData): Promise<ShopeeConnectionRecord> {
    const common = { ...data, isActive: true, lastRefreshedAt: new Date() };
    return this.prisma.shopeeConnection.upsert({
      where: { tenantId },
      create: { tenantId, ...common },
      update: common,
    });
  }

  async deactivate(tenantId: string): Promise<void> {
    await this.prisma.shopeeConnection.update({ where: { tenantId }, data: { isActive: false } });
  }
}
