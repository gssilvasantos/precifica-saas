import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PriceListExceptionRepository } from '../application/ports/price-list-exception-repository.port';
import { PriceListException, PriceListExceptionCreateData } from '../domain/price-list.entity';

@Injectable()
export class PrismaPriceListExceptionRepository implements PriceListExceptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: PriceListExceptionCreateData): Promise<PriceListException> {
    const record = await this.prisma.priceListException.upsert({
      where: { priceListId_productId: { priceListId: data.priceListId, productId: data.productId } },
      create: data,
      update: { overridePrice: data.overridePrice },
    });
    return this.toDomain(record);
  }

  async findAllByList(tenantId: string, priceListId: string): Promise<PriceListException[]> {
    const records = await this.prisma.priceListException.findMany({
      where: { tenantId, priceListId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async findOne(tenantId: string, priceListId: string, productId: string): Promise<PriceListException | null> {
    const record = await this.prisma.priceListException.findFirst({ where: { tenantId, priceListId, productId } });
    return record ? this.toDomain(record) : null;
  }

  async remove(id: string): Promise<void> {
    await this.prisma.priceListException.delete({ where: { id } });
  }

  // Decimal -> number na borda, mesmo padrão de PrismaAccountsPayableRepository.
  private toDomain(record: Record<string, unknown> & { overridePrice: { toString(): string } }): PriceListException {
    return { ...record, overridePrice: Number(record.overridePrice) } as PriceListException;
  }
}
