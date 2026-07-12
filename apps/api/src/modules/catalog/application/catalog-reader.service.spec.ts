import { CatalogReaderService } from './catalog-reader.service';
import { ProductRepository } from './ports/product-repository.port';
import { PackagingRepository } from './ports/packaging-repository.port';
import { Product } from '../domain/product.entity';
import { Packaging } from '../domain/packaging.entity';

// custo efetivo = Product.costPrice + (Packaging.costPrice ?? 0) — esta é a
// resposta de código à pergunta do usuário ("como garantir que o
// estrategista saiba que o custo subiu se eu trocar a embalagem"): sem
// nenhum cache aqui, findBySku sempre lê o par (produto, embalagem) atual.
describe('CatalogReaderService (custo efetivo com Packaging)', () => {
  const baseProduct: Product = {
    id: 'prod-1',
    tenantId: 'tenant-1',
    skuCode: 'SKU-001',
    name: 'Produto Teste',
    internalCategory: null,
    supplierId: null,
    taxProfileId: null,
    packagingId: null,
    costPrice: 60,
    desiredMarginPct: 30,
    minimumMarginPct: 20,
    autoRepricingEnabled: false,
    weightKg: 1,
    packagingWeightKg: 0,
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
    packedWeightKg: 1,
    cubicWeightKg: 1,
    shippingWeightKg: 1,
    sourceSystem: 'MANUAL',
    externalId: null,
    isActive: true,
  } as unknown as Product;

  const packaging: Packaging = {
    id: 'pack-1',
    tenantId: 'tenant-1',
    name: 'Caixa 20x15x10',
    weightG: 150,
    heightCm: 10,
    widthCm: 15,
    lengthCm: 20,
    costPrice: 8.5,
    stockQuantity: 100,
    isActive: true,
    purpose: 'STANDARD',
    maxCapacityKg: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function buildService(product: Product, packagingFound: Packaging | null) {
    const products: jest.Mocked<ProductRepository> = {
      create: jest.fn(),
      findAllActive: jest.fn().mockResolvedValue([product]),
      findById: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
      findByExternalId: jest.fn(),
    };
    const packagings: jest.Mocked<PackagingRepository> = {
      create: jest.fn(),
      findAllActive: jest.fn(),
      findById: jest.fn().mockResolvedValue(packagingFound),
      update: jest.fn(),
      deactivate: jest.fn(),
      findSafetyDefault: jest.fn(),
      findAllMaster: jest.fn(),
    };
    return { service: new CatalogReaderService(products, packagings), products, packagings };
  }

  it('sem packagingId: custo efetivo é só o custo do produto', async () => {
    const { service, packagings } = buildService(baseProduct, null);

    const result = await service.findBySku('tenant-1', 'SKU-001');

    expect(result?.costPrice).toBe(60);
    expect(result?.productCostPrice).toBe(60);
    expect(result?.packagingCostPrice).toBeNull();
    expect(packagings.findById).not.toHaveBeenCalled();
  });

  it('com packagingId vinculado: custo efetivo soma Product.costPrice + Packaging.costPrice', async () => {
    const productWithPackaging = { ...baseProduct, packagingId: 'pack-1' };
    const { service, packagings } = buildService(productWithPackaging, packaging);

    const result = await service.findBySku('tenant-1', 'SKU-001');

    expect(result?.costPrice).toBe(68.5);
    expect(result?.productCostPrice).toBe(60);
    expect(result?.packagingCostPrice).toBe(8.5);
    expect(packagings.findById).toHaveBeenCalledWith('tenant-1', 'pack-1');
  });

  it('SKU inexistente: retorna null sem consultar Packaging', async () => {
    const { service, packagings } = buildService(baseProduct, null);

    const result = await service.findBySku('tenant-1', 'SKU-INEXISTENTE');

    expect(result).toBeNull();
    expect(packagings.findById).not.toHaveBeenCalled();
  });
});
