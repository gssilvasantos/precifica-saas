import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  FreightProviderConnectionRecord,
  FreightProviderConnectionRepository,
  FreightProviderConnectionUpsertData,
} from '../application/ports/freight-provider-connection-repository.port';

@Injectable()
export class PrismaFreightProviderConnectionRepository implements FreightProviderConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: FreightProviderConnectionUpsertData): Promise<FreightProviderConnectionRecord> {
    return this.prisma.freightProviderConnection.upsert({
      where: { tenantId_providerCode: { tenantId: data.tenantId, providerCode: data.providerCode } },
      create: { tenantId: data.tenantId, providerCode: data.providerCode, credentialEnc: data.credentialEnc, isActive: data.isActive ?? true },
      update: { credentialEnc: data.credentialEnc, isActive: data.isActive ?? true },
    });
  }

  async findByTenantAndProvider(tenantId: string, providerCode: string): Promise<FreightProviderConnectionRecord | null> {
    return this.prisma.freightProviderConnection.findUnique({ where: { tenantId_providerCode: { tenantId, providerCode } } });
  }

  async findAllByTenant(tenantId: string): Promise<FreightProviderConnectionRecord[]> {
    return this.prisma.freightProviderConnection.findMany({ where: { tenantId } });
  }

  async remove(tenantId: string, providerCode: string): Promise<void> {
    await this.prisma.freightProviderConnection.deleteMany({ where: { tenantId, providerCode } });
  }
}
