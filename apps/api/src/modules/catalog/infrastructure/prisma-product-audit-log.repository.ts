import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ProductAuditLogRepository,
  CreateProductAuditLogData,
  ProductAuditLogEntry,
} from '../application/ports/product-audit-log-repository.port';

@Injectable()
export class PrismaProductAuditLogRepository implements ProductAuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateProductAuditLogData): Promise<ProductAuditLogEntry> {
    // source é union type de string no domínio e enum nominal no client do
    // Prisma — mesmo valor, cast necessário (mesmo padrão do resto do
    // projeto, ver prisma-marketplace-rule.repository.ts).
    const record = await this.prisma.productAuditLog.create({ data: data as never });
    return record as ProductAuditLogEntry;
  }

  async findAllForProduct(tenantId: string, productId: string): Promise<ProductAuditLogEntry[]> {
    const records = await this.prisma.productAuditLog.findMany({
      where: { tenantId, productId },
      orderBy: { changedAt: 'desc' },
    });
    return records as ProductAuditLogEntry[];
  }
}
