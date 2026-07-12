import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PromotionCampaignRepository } from '../application/ports/promotion-campaign-repository.port';
import { PromotionCampaign, PromotionCampaignCreateData, PromotionCampaignStatus } from '../domain/promotion-campaign.entity';

@Injectable()
export class PrismaPromotionCampaignRepository implements PromotionCampaignRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: PromotionCampaignCreateData): Promise<PromotionCampaign> {
    const record = await this.prisma.promotionCampaign.create({ data });
    return this.toDomain(record);
  }

  async findById(tenantId: string, id: string): Promise<PromotionCampaign | null> {
    const record = await this.prisma.promotionCampaign.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record) : null;
  }

  async findAllByTenant(tenantId: string): Promise<PromotionCampaign[]> {
    const records = await this.prisma.promotionCampaign.findMany({
      where: { tenantId },
      orderBy: { startAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  private toDomain(record: {
    id: string;
    tenantId: string;
    name: string;
    channelCode: string;
    startAt: Date;
    endAt: Date;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): PromotionCampaign {
    return {
      id: record.id,
      tenantId: record.tenantId,
      name: record.name,
      channelCode: record.channelCode,
      startAt: record.startAt,
      endAt: record.endAt,
      status: record.status as PromotionCampaignStatus,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
