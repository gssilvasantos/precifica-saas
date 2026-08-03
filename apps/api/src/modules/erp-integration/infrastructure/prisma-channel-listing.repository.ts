import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ChannelListingRecord,
  ChannelListingRepository,
  ChannelListingUpsertData,
} from '../application/ports/channel-listing-repository.port';

@Injectable()
export class PrismaChannelListingRepository implements ChannelListingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: ChannelListingUpsertData): Promise<ChannelListingRecord> {
    const record = await this.prisma.channelListing.upsert({
      where: { tenantId_channelCode_externalId: { tenantId: data.tenantId, channelCode: data.channelCode, externalId: data.externalId } },
      create: { ...data, lastSyncedAt: new Date() },
      update: { ...data, lastSyncedAt: new Date() },
    });
    return this.toDomain(record);
  }

  async findBySku(tenantId: string, channelCode: string, skuCode: string): Promise<ChannelListingRecord | null> {
    const record = await this.prisma.channelListing.findFirst({ where: { tenantId, channelCode, skuCode } });
    return record ? this.toDomain(record) : null;
  }

  async findAllByTenant(tenantId: string): Promise<ChannelListingRecord[]> {
    const records = await this.prisma.channelListing.findMany({ where: { tenantId }, orderBy: { skuCode: 'asc' } });
    return records.map((r) => this.toDomain(r));
  }

  async findSkusByExternalIds(
    tenantId: string,
    channelCode: string,
    externalIds: string[],
  ): Promise<{ externalId: string; skuCode: string }[]> {
    if (externalIds.length === 0) return [];
    const records = await this.prisma.channelListing.findMany({
      where: { tenantId, channelCode, externalId: { in: externalIds } },
      select: { externalId: true, skuCode: true },
    });
    return records;
  }

  private toDomain(record: Record<string, unknown> & { currentPrice: { toString(): string } | null }): ChannelListingRecord {
    return {
      ...record,
      currentPrice: record.currentPrice !== null ? Number(record.currentPrice) : null,
    } as ChannelListingRecord;
  }
}
