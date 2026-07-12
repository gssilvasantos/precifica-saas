import { Product, ProductCreateData, ProductSourceSystem } from '../../domain/product.entity';

export type ProductUpdateData = Partial<Omit<ProductCreateData, 'tenantId' | 'skuCode'>>;

export interface ProductRepository {
  create(data: ProductCreateData): Promise<Product>;
  findAllActive(tenantId: string): Promise<Product[]>;
  findById(tenantId: string, id: string): Promise<Product | null>;
  update(id: string, data: ProductUpdateData): Promise<Product>;
  deactivate(id: string): Promise<Product>;
  // Usado pelo CatalogSyncWriterService (Etapa 5) para decidir se um produto
  // vindo do ERP é criação ou atualização — vínculo é por proveniência, não
  // por SKU, porque o SKU pode mudar do lado do ERP sem trocar o produto.
  findByExternalId(tenantId: string, sourceSystem: ProductSourceSystem, externalId: string): Promise<Product | null>;
}

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');
