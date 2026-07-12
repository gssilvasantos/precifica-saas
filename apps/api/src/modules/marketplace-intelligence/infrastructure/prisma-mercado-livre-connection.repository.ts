import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  MercadoLivreConnectionRecord,
  MercadoLivreConnectionRepository,
  MercadoLivreConnectionUpsertData,
} from '../application/ports/mercado-livre-connection-repository.port';

@Injectable()
export class PrismaMercadoLivreConnectionRepository implements MercadoLivreConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByTenant(tenantId: string): Promise<MercadoLivreConnectionRecord | null> {
    return this.prisma.mercadoLivreConnection.findUnique({ where: { tenantId } });
  }

  findAllActive(): Promise<MercadoLivreConnectionRecord[]> {
    return this.prisma.mercadoLivreConnection.findMany({ where: { isActive: true } });
  }

  upsert(tenantId: string, data: MercadoLivreConnectionUpsertData): Promise<MercadoLivreConnectionRecord> {
    const common = { ...data, isActive: true, lastRefreshedAt: new Date() };
    return this.prisma.mercadoLivreConnection.upsert({
      where: { tenantId },
      create: { tenantId, ...common },
      update: common,
    });
  }

  async deactivate(tenantId: string): Promise<void> {
    await this.prisma.mercadoLivreConnection.update({ where: { tenantId }, data: { isActive: false } });
  }
}
