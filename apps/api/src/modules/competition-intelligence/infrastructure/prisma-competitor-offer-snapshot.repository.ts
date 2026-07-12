import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  CompetitorOfferSnapshotRepository,
  OfferSnapshotCreateData,
} from '../application/ports/competitor-offer-snapshot-repository.port';

@Injectable()
export class PrismaCompetitorOfferSnapshotRepository implements CompetitorOfferSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(data: OfferSnapshotCreateData[]): Promise<void> {
    if (data.length === 0) return;
    await this.prisma.competitorOfferSnapshot.createMany({ data });
  }
}
