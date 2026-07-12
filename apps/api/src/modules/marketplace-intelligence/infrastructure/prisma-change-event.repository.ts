import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ChangeEventCreateData,
  ChangeEventRepository,
} from '../application/ports/change-event-repository.port';
import { MarketplaceChangeEvent } from '../domain/change-event.entity';

@Injectable()
export class PrismaChangeEventRepository implements ChangeEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: ChangeEventCreateData): Promise<MarketplaceChangeEvent> {
    // ruleType/resolutionStatus são union types de string no domínio e enums
    // nominais no client do Prisma — mesmos valores, cast necessário (ver
    // nota equivalente em prisma-marketplace-rule.repository.ts).
    return this.prisma.marketplaceChangeEvent.create({ data: data as any }) as unknown as Promise<MarketplaceChangeEvent>;
  }

  findRecent(marketplaceId?: string, limit = 50): Promise<MarketplaceChangeEvent[]> {
    return this.prisma.marketplaceChangeEvent.findMany({
      where: marketplaceId ? { marketplaceId } : undefined,
      orderBy: { detectedAt: 'desc' },
      take: limit,
    }) as unknown as Promise<MarketplaceChangeEvent[]>;
  }
}
