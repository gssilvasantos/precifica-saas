import { ProductAuditSource } from '../../domain/product-audit';

export interface CreateProductAuditLogData {
  tenantId: string;
  productId: string;
  skuCode: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedByUserId: string;
  source: ProductAuditSource;
}

export interface ProductAuditLogEntry extends CreateProductAuditLogData {
  id: string;
  changedAt: Date;
}

export interface ProductAuditLogRepository {
  create(data: CreateProductAuditLogData): Promise<ProductAuditLogEntry>;
  // Ordenado do mais recente para o mais antigo — mesmo padrão de leitura
  // de qualquer trilha de auditoria/histórico já usado no projeto
  // (ProviderSyncLog, MarketplaceChangeEvent).
  findAllForProduct(tenantId: string, productId: string): Promise<ProductAuditLogEntry[]>;
}

export const PRODUCT_AUDIT_LOG_REPOSITORY = Symbol('PRODUCT_AUDIT_LOG_REPOSITORY');
