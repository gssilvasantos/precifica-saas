import { ProductLot, ProductLotCreateData, ProductLotStatus } from '../../domain/product-lot';

export interface ProductLotRepository {
  create(data: ProductLotCreateData): Promise<ProductLot>;
  findByTenantAndSku(tenantId: string, skuCode: string): Promise<ProductLot[]>;
  findOne(tenantId: string, skuCode: string, lotCode: string): Promise<ProductLot | null>;
  updateStatus(id: string, status: ProductLotStatus): Promise<ProductLot>;
}

export const PRODUCT_LOT_REPOSITORY = Symbol('PRODUCT_LOT_REPOSITORY');
