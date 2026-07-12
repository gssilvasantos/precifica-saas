import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { StockLedgerRepository } from '../application/ports/stock-ledger-repository.port';

@Injectable()
export class PrismaStockLedgerRepository implements StockLedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(tenantId: string, warehouseId: string, skuCode: string): Promise<number> {
    const result = await this.prisma.stockLedgerEntry.aggregate({
      where: { tenantId, warehouseId, skuCode },
      _sum: { quantityDelta: true },
    });
    return result._sum.quantityDelta ?? 0;
  }

  async listBalancesByWarehouse(tenantId: string, warehouseId: string): Promise<Array<{ skuCode: string; balance: number }>> {
    const groups = await this.prisma.stockLedgerEntry.groupBy({
      by: ['skuCode'],
      where: { tenantId, warehouseId },
      _sum: { quantityDelta: true },
    });
    return groups.map((g) => ({ skuCode: g.skuCode, balance: g._sum.quantityDelta ?? 0 }));
  }
}
