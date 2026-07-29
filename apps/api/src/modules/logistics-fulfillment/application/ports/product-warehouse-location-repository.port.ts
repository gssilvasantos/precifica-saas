import { ProductWarehouseLocation, ProductWarehouseLocationUpsertData } from '../../domain/product-warehouse-location.entity';

export interface ProductWarehouseLocationRepository {
  // Idempotente por (tenantId, warehouseId, skuCode) — setar de novo
  // SOBRESCREVE a localização anterior (nunca acumula histórico, ver
  // racional no schema.prisma).
  upsert(data: ProductWarehouseLocationUpsertData): Promise<ProductWarehouseLocation>;
  findByWarehouse(tenantId: string, warehouseId: string): Promise<ProductWarehouseLocation[]>;
  findOne(tenantId: string, warehouseId: string, skuCode: string): Promise<ProductWarehouseLocation | null>;
}

export const PRODUCT_WAREHOUSE_LOCATION_REPOSITORY = Symbol('PRODUCT_WAREHOUSE_LOCATION_REPOSITORY');
