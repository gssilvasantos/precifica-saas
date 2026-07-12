import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { Marketplace, MarketplaceRepository } from '../application/ports/marketplace-repository.port';

@Injectable()
export class PrismaMarketplaceRepository implements MarketplaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByCode(code: string): Promise<Marketplace | null> {
    return this.prisma.marketplace.findUnique({ where: { code } });
  }

  findAllActive(): Promise<Marketplace[]> {
    return this.prisma.marketplace.findMany({ where: { isActive: true }, orderBy: { displayName: 'asc' } });
  }
}
