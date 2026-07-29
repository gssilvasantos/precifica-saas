import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PriceListRepository } from '../application/ports/price-list-repository.port';
import { PriceList, PriceListCreateData, PriceListUpdateData } from '../domain/price-list.entity';

@Injectable()
export class PrismaPriceListRepository implements PriceListRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: PriceListCreateData): Promise<PriceList> {
    const record = await this.prisma.priceList.create({ data });
    return record;
  }

  async findAllActive(tenantId: string): Promise<PriceList[]> {
    return this.prisma.priceList.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' } });
  }

  async findById(tenantId: string, id: string): Promise<PriceList | null> {
    return this.prisma.priceList.findFirst({ where: { id, tenantId } });
  }

  async update(id: string, data: PriceListUpdateData): Promise<PriceList> {
    return this.prisma.priceList.update({ where: { id }, data });
  }

  async deactivate(id: string): Promise<PriceList> {
    return this.prisma.priceList.update({ where: { id }, data: { isActive: false } });
  }
}
