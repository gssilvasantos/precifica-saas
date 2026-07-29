import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  CarrierServiceCreateData,
  CarrierServiceRecord,
  CarrierServiceRepository,
  CarrierServiceUpdateData,
} from '../application/ports/carrier-service-repository.port';

@Injectable()
export class PrismaCarrierServiceRepository implements CarrierServiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CarrierServiceCreateData): Promise<CarrierServiceRecord> {
    const record = await this.prisma.carrierService.create({ data });
    return record as CarrierServiceRecord;
  }

  async findById(tenantId: string, id: string): Promise<CarrierServiceRecord | null> {
    const record = await this.prisma.carrierService.findFirst({ where: { id, tenantId } });
    return record as CarrierServiceRecord | null;
  }

  async findByNameForCarrier(carrierId: string, name: string): Promise<CarrierServiceRecord | null> {
    const record = await this.prisma.carrierService.findFirst({ where: { carrierId, name } });
    return record as CarrierServiceRecord | null;
  }

  async findAllByCarrier(tenantId: string, carrierId: string): Promise<CarrierServiceRecord[]> {
    const records = await this.prisma.carrierService.findMany({ where: { tenantId, carrierId }, orderBy: { name: 'asc' } });
    return records as CarrierServiceRecord[];
  }

  async findAllByTenant(tenantId: string): Promise<CarrierServiceRecord[]> {
    const records = await this.prisma.carrierService.findMany({ where: { tenantId } });
    return records as CarrierServiceRecord[];
  }

  async update(id: string, data: CarrierServiceUpdateData): Promise<CarrierServiceRecord> {
    const record = await this.prisma.carrierService.update({ where: { id }, data });
    return record as CarrierServiceRecord;
  }
}
