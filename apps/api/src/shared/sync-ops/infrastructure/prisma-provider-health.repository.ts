import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderHealthRepository } from '../ports/provider-health-repository.port';

@Injectable()
export class PrismaProviderHealthRepository implements ProviderHealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async recordSuccess(providerCode: string): Promise<void> {
    await this.prisma.providerHealth.upsert({
      where: { providerCode },
      create: { providerCode, status: 'UP', consecutiveFailures: 0, lastSuccessAt: new Date() },
      update: { status: 'UP', consecutiveFailures: 0, lastSuccessAt: new Date() },
    });
  }

  async recordFailure(providerCode: string, error: string): Promise<number> {
    const current = await this.prisma.providerHealth.findUnique({ where: { providerCode } });
    const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1;
    // Circuit breaker simples: 3+ falhas seguidas = DOWN (ver seção 9 do
    // documento de arquitetura do Marketplace Intelligence).
    const status = consecutiveFailures >= 3 ? 'DOWN' : 'DEGRADED';
    await this.prisma.providerHealth.upsert({
      where: { providerCode },
      create: { providerCode, status, consecutiveFailures, lastFailureAt: new Date(), lastError: error },
      update: { status, consecutiveFailures, lastFailureAt: new Date(), lastError: error },
    });
    return consecutiveFailures;
  }
}
