import { Inject, Injectable } from '@nestjs/common';
import {
  PRODUCT_AUDIT_LOG_REPOSITORY,
  ProductAuditLogRepository,
  ProductAuditLogEntry,
} from './ports/product-audit-log-repository.port';
import { ProductAuditEntryInput, ProductAuditSource } from '../domain/product-audit';

// Serviço fino, de propósito: só serializa entradas de domínio
// (ProductAuditEntryInput, valores numéricos) para o formato de persistência
// (strings) e delega ao repositório. Nenhuma lógica de "o que auditar" mora
// aqui — isso é diffGovernanceFields (domain/product-audit.ts), puro e
// testável sem infraestrutura nenhuma.
@Injectable()
export class ProductAuditLogService {
  constructor(@Inject(PRODUCT_AUDIT_LOG_REPOSITORY) private readonly repo: ProductAuditLogRepository) {}

  async record(
    tenantId: string,
    entries: ProductAuditEntryInput[],
    actor: { userId: string; source: ProductAuditSource },
  ): Promise<void> {
    for (const entry of entries) {
      await this.repo.create({
        tenantId,
        productId: entry.productId,
        skuCode: entry.skuCode,
        field: entry.field,
        oldValue: entry.oldValue === null ? null : String(entry.oldValue),
        newValue: entry.newValue === null ? null : String(entry.newValue),
        changedByUserId: actor.userId,
        source: actor.source,
      });
    }
  }

  listForProduct(tenantId: string, productId: string): Promise<ProductAuditLogEntry[]> {
    return this.repo.findAllForProduct(tenantId, productId);
  }
}
