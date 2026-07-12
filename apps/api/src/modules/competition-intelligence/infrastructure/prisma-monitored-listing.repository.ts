import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  MonitoredListing,
  MonitoredListingCreateData,
  MonitoredListingRepository,
} from '../application/ports/monitored-listing-repository.port';

@Injectable()
export class PrismaMonitoredListingRepository implements MonitoredListingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: MonitoredListingCreateData): Promise<MonitoredListing> {
    const record = await this.prisma.monitoredCompetitorListing.create({ data });
    return record;
  }

  async findAllActive(): Promise<MonitoredListing[]> {
    return this.prisma.monitoredCompetitorListing.findMany({ where: { isActive: true } });
  }

  async findAllActiveByTenant(tenantId: string): Promise<MonitoredListing[]> {
    return this.prisma.monitoredCompetitorListing.findMany({ where: { tenantId, isActive: true } });
  }

  async setActive(id: string, tenantId: string, isActive: boolean): Promise<void> {
    await this.prisma.monitoredCompetitorListing.updateMany({ where: { id, tenantId }, data: { isActive } });
  }
}
