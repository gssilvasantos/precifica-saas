import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  CarrierCreateData,
  CarrierRecord,
  CarrierRepository,
  CarrierUpdateData,
} from '../application/ports/carrier-repository.port';

@Injectable()
export class PrismaCarrierRepository implements CarrierRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CarrierCreateData): Promise<CarrierRecord> {
    const record = await this.prisma.carrier.create({ data });
    return record as CarrierRecord;
  }

  async findById(tenantId: string, id: string): Promise<CarrierRecord | null> {
    const record = await this.prisma.carrier.findFirst({ where: { id, tenantId } });
    return record as CarrierRecord | null;
  }

  async findByName(tenantId: string, name: string): Promise<CarrierRecord | null> {
    const record = await this.prisma.carrier.findFirst({ where: { tenantId, name } });
    return record as CarrierRecord | null;
  }

  async findAllByTenant(tenantId: string): Promise<CarrierRecord[]> {
    const records = await this.prisma.carrier.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    return records as CarrierRecord[];
  }

  async update(id: string, data: CarrierUpdateData): Promise<CarrierRecord> {
    const record = await this.prisma.carrier.update({ where: { id }, data });
    return record as CarrierRecord;
  }
}
