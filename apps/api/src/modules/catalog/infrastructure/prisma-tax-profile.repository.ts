import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  TaxProfileCreateData,
  TaxProfileRepository,
  TaxProfileUpdateData,
} from '../application/ports/tax-profile-repository.port';

@Injectable()
export class PrismaTaxProfileRepository implements TaxProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: TaxProfileCreateData) {
    return this.prisma.taxProfile.create({ data });
  }

  findAll(tenantId: string) {
    return this.prisma.taxProfile.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  findById(tenantId: string, id: string) {
    return this.prisma.taxProfile.findFirst({ where: { id, tenantId } });
  }

  update(id: string, data: TaxProfileUpdateData) {
    return this.prisma.taxProfile.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.taxProfile.delete({ where: { id } });
  }
}
