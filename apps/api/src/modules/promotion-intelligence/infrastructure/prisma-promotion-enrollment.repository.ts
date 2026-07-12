import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PromotionEnrollmentRepository } from '../application/ports/promotion-enrollment-repository.port';
import { PromotionEnrollment, PromotionEnrollmentCreateData, EnrollmentStatus } from '../domain/promotion-enrollment.entity';
import { MarginStatus } from '../domain/margin-calculator';

@Injectable()
export class PrismaPromotionEnrollmentRepository implements PromotionEnrollmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Upsert por (campaignId, skuCode) — reavaliar a mesma adesão sobrescreve
  // o snapshot anterior (ver racional completo no port). computedAt sempre
  // atualiza para "agora", mesmo em cima de um registro existente.
  async create(data: PromotionEnrollmentCreateData): Promise<PromotionEnrollment> {
    const record = await this.prisma.promotionEnrollment.upsert({
      where: { campaignId_skuCode: { campaignId: data.campaignId, skuCode: data.skuCode } },
      create: data,
      update: { ...data, computedAt: new Date() },
    });
    return this.toDomain(record);
  }

  async findByCampaignAndSku(tenantId: string, campaignId: string, skuCode: string): Promise<PromotionEnrollment | null> {
    const record = await this.prisma.promotionEnrollment.findFirst({ where: { tenantId, campaignId, skuCode } });
    return record ? this.toDomain(record) : null;
  }

  async findAllByCampaign(tenantId: string, campaignId: string): Promise<PromotionEnrollment[]> {
    const records = await this.prisma.promotionEnrollment.findMany({
      where: { tenantId, campaignId },
      orderBy: { computedAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  // Converte os Decimal do Prisma para number na borda, mesmo padrão de
  // PrismaProductRepository/PrismaPackagingRepository.
  private toDomain(
    record: Record<string, unknown> & {
      promotionalPrice: { toString(): string };
      costPriceUsed: { toString(): string };
      feesAmount: { toString(): string };
      taxAmount: { toString(): string };
      logisticsCost: { toString(): string };
      netMarginAmount: { toString(): string };
      marginStatus: string;
      enrollmentStatus: string;
    },
  ): PromotionEnrollment {
    return {
      ...record,
      promotionalPrice: Number(record.promotionalPrice),
      costPriceUsed: Number(record.costPriceUsed),
      feesAmount: Number(record.feesAmount),
      taxAmount: Number(record.taxAmount),
      logisticsCost: Number(record.logisticsCost),
      netMarginAmount: Number(record.netMarginAmount),
      marginStatus: record.marginStatus as MarginStatus,
      enrollmentStatus: record.enrollmentStatus as EnrollmentStatus,
    } as PromotionEnrollment;
  }
}
