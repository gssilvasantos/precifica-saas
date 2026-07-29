import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductStructureService } from './product-structure.service';
import { ProductRepository } from './ports/product-repository.port';
import { ProductStructureComponent, ProductStructureRepository } from './ports/product-structure-repository.port';
import { Product } from '../domain/product.entity';

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    tenantId: 'tenant-1',
    skuCode: 'KIT-1',
    name: 'Kit Presente',
    internalCategory: null,
    categoryId: null,
    supplierId: null,
    taxProfileId: null,
    packagingId: null,
    isKit: true,
    controlaLote: false,
    parentProductId: null,
    variantAttributes: null,
    costPrice: 10,
    desiredMarginPct: 30,
    minimumMarginPct: 10,
    autoRepricingEnabled: false,
    mapPrice: null,
    weightKg: 1,
    packagingWeightKg: 0,
    packedWeightKg: 1,
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
    cubicWeightKg: 1,
    shippingWeightKg: 1,
    ncm: null,
    gtin: null,
    fiscalOriginCode: null,
    cest: null,
    stockQuantity: 0,
    erpSalePrice: null,
    photoUrls: [],
    sourceSystem: 'MANUAL',
    externalId: null,
    lastSyncedAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildComponent(overrides: Partial<ProductStructureComponent> = {}): ProductStructureComponent {
  return {
    id: 'comp-1',
    tenantId: 'tenant-1',
    parentSkuCode: 'KIT-1',
    componentSkuCode: 'COMP-1',
    quantity: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ProductStructureService', () => {
  function buildService(product: Product | null) {
    const products: jest.Mocked<ProductRepository> = {
      create: jest.fn(),
      findAllActive: jest.fn(),
      findById: jest.fn().mockResolvedValue(product),
      update: jest.fn(),
      deactivate: jest.fn(),
      findByExternalId: jest.fn(),
      findChildren: jest.fn(),
    };
    const structures: jest.Mocked<ProductStructureRepository> = {
      findByParentSku: jest.fn().mockResolvedValue([]),
      replaceAll: jest.fn(),
    };
    const service = new ProductStructureService(products, structures);
    return { service, products, structures };
  }

  describe('setComponents', () => {
    it('rejeita produto não encontrado', async () => {
      const { service } = buildService(null);
      await expect(service.setComponents('tenant-1', 'product-1', [{ componentSkuCode: 'COMP-1', quantity: 1 }])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejeita produto que não é kit', async () => {
      const { service } = buildService(buildProduct({ isKit: false }));
      await expect(service.setComponents('tenant-1', 'product-1', [{ componentSkuCode: 'COMP-1', quantity: 1 }])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejeita componentes inválidos (lista vazia)', async () => {
      const { service } = buildService(buildProduct());
      await expect(service.setComponents('tenant-1', 'product-1', [])).rejects.toThrow(BadRequestException);
    });

    it('substitui a estrutura via replaceAll usando o skuCode do produto pai', async () => {
      const { service, structures } = buildService(buildProduct({ skuCode: 'KIT-1' }));
      const component = buildComponent();
      structures.replaceAll.mockResolvedValue([component]);

      const result = await service.setComponents('tenant-1', 'product-1', [{ componentSkuCode: 'COMP-1', quantity: 2 }]);

      expect(structures.replaceAll).toHaveBeenCalledWith('tenant-1', 'KIT-1', [{ componentSkuCode: 'COMP-1', quantity: 2 }]);
      expect(result).toEqual([component]);
    });
  });

  describe('getByProductId', () => {
    it('resolve o skuCode do produto e busca a estrutura', async () => {
      const { service, structures } = buildService(buildProduct({ skuCode: 'KIT-1' }));
      const component = buildComponent();
      structures.findByParentSku.mockResolvedValue([component]);

      const result = await service.getByProductId('tenant-1', 'product-1');

      expect(structures.findByParentSku).toHaveBeenCalledWith('tenant-1', 'KIT-1');
      expect(result).toEqual([component]);
    });
  });

  describe('getComponents (ProductStructureReader)', () => {
    it('devolve componentSkuCode/quantity por skuCode direto, sem passar pelo produto', async () => {
      const { service, structures } = buildService(null);
      structures.findByParentSku.mockResolvedValue([buildComponent({ componentSkuCode: 'COMP-9', quantity: 3 })]);

      const result = await service.getComponents('tenant-1', 'KIT-1');

      expect(structures.findByParentSku).toHaveBeenCalledWith('tenant-1', 'KIT-1');
      expect(result).toEqual([{ componentSkuCode: 'COMP-9', quantity: 3 }]);
    });
  });
});
