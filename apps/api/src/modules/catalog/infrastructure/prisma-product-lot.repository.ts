import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ProductLotRepository } from '../application/ports/product-lot-repository.port';
import { ProductLot, ProductLotCreateData, ProductLotStatus } from '../domain/product-lot';

@Injectable()
export class PrismaProductLotRepository implements ProductLotRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: ProductLotCreateData): Promise<ProductLot> {
    const record = await this.prisma.productLot.create({
      data: {
        tenantId: data.tenantId,
        skuCode: data.skuCode,
        lotCode: data.lotCode,
        dataFabricacao: data.dataFabricacao ?? null,
        dataValidade: data.dataValidade,
        diasPermitidoVenda: data.diasPermitidoVenda ?? 0,
        codigoAgregacao: data.codigoAgregacao ?? null,
        status: (data.status ?? 'ATIVO') as never,
      },
    });
    return this.toDomain(record);
  }

  async findByTenantAndSku(tenantId: string, skuCode: string): Promise<ProductLot[]> {
    const records = await this.prisma.productLot.findMany({
      where: { tenantId, skuCode },
      orderBy: { dataValidade: 'asc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async findOne(tenantId: string, skuCode: string, lotCode: string): Promise<ProductLot | null> {
    const record = await this.prisma.productLot.findFirst({ where: { tenantId, skuCode, lotCode } });
    return record ? this.toDomain(record) : null;
  }

  async updateStatus(id: string, status: ProductLotStatus): Promise<ProductLot> {
    const record = await this.prisma.productLot.update({ where: { id }, data: { status: status as never } });
    return this.toDomain(record);
  }

  private toDomain(record: {
    id: string;
    tenantId: string;
    skuCode: string;
    lotCode: string;
    dataFabricacao: Date | null;
    dataValidade: Date;
    diasPermitidoVenda: number;
    codigoAgregacao: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): ProductLot {
    return { ...record, status: record.status as ProductLotStatus };
  }
}
