import { ProductsService } from './products.service';
import { ProductRepository } from './ports/product-repository.port';
import { SupplierRepository } from './ports/supplier-repository.port';
import { TaxProfileRepository } from './ports/tax-profile-repository.port';
import { PackagingRepository } from './ports/packaging-repository.port';
import { ShippingWeightCalculator, PackageWeightResult } from '../../../shared/contracts/shipping-weight-calculator.port';
import { Product } from '../domain/product.entity';
import { Packaging } from '../domain/packaging.entity';

// Foco desta suíte: a interação entre Packaging e o recálculo de peso —
// trocar SÓ a embalagem (nenhum campo físico do produto em si) precisa
// disparar o mesmo recálculo de peso cubado que mudar weightKg/dimensões
// dispararia. Ver comentário `packagingChanged` em products.service.ts.
describe('ProductsService (integração com Packaging)', () => {
  const currentProduct: Product = {
    id: 'prod-1',
    tenantId: 'tenant-1',
    skuCode: 'SKU-001',
    name: 'Produto Teste',
    internalCategory: null,
    supplierId: null,
    taxProfileId: null,
    packagingId: null,
    isKit: false,
    costPrice: 60,
    desiredMarginPct: 30,
    minimumMarginPct: 20,
    autoRepricingEnabled: false,
    weightKg: 1,
    packagingWeightKg: 0.1,
    packedWeightKg: 1.1,
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
    cubicWeightKg: 1,
    shippingWeightKg: 1.1,
    stockQuantity: 0,
    erpSalePrice: null,
    photoUrls: [],
    sourceSystem: 'MANUAL',
    externalId: null,
    lastSyncedAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const packaging: Packaging = {
    id: 'pack-1',
    tenantId: 'tenant-1',
    name: 'Caixa 20x15x10',
    weightG: 300,
    heightCm: 12,
    widthCm: 18,
    lengthCm: 22,
    costPrice: 5,
    stockQuantity: 50,
    isActive: true,
    purpose: 'STANDARD',
    maxCapacityKg: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const weightResult: PackageWeightResult = { packedWeightKg: 1.3, cubicWeightKg: 1.32, shippingWeightKg: 1.32 };

  function buildService() {
    const products: jest.Mocked<ProductRepository> = {
      create: jest.fn(),
      findAllActive: jest.fn(),
      findById: jest.fn().mockResolvedValue(currentProduct),
      update: jest.fn().mockResolvedValue({ ...currentProduct, packagingId: 'pack-1' }),
      deactivate: jest.fn(),
      findByExternalId: jest.fn(),
    };
    const suppliers = {} as jest.Mocked<SupplierRepository>;
    const taxProfiles = {} as jest.Mocked<TaxProfileRepository>;
    const packagings: jest.Mocked<PackagingRepository> = {
      create: jest.fn(),
      findAllActive: jest.fn(),
      findById: jest.fn().mockResolvedValue(packaging),
      update: jest.fn(),
      deactivate: jest.fn(),
      findSafetyDefault: jest.fn(),
      findAllMaster: jest.fn(),
    };
    const shippingWeight: jest.Mocked<ShippingWeightCalculator> = {
      calculate: jest.fn().mockResolvedValue(weightResult),
    };

    const service = new ProductsService(products, suppliers, taxProfiles, packagings, shippingWeight);
    return { service, products, packagings, shippingWeight };
  }

  it('trocar só o packagingId (nenhum campo físico) ainda dispara recálculo de peso usando as dimensões da nova embalagem', async () => {
    const { service, packagings, shippingWeight } = buildService();

    await service.update('tenant-1', 'prod-1', { packagingId: 'pack-1' });

    expect(packagings.findById).toHaveBeenCalledWith('tenant-1', 'pack-1');
    expect(shippingWeight.calculate).toHaveBeenCalledTimes(1);
    const [, input] = shippingWeight.calculate.mock.calls[0];
    // dimensões vieram da EMBALAGEM (22/18/12), não do produto (10/10/10)
    expect(input).toMatchObject({ lengthCm: 22, widthCm: 18, heightCm: 12 });
    // peso do produto em si (1kg) permanece intocado
    expect(input.weightKg).toBe(1);
    // 300g convertidos para 0.3kg
    expect(input.packagingWeightKg).toBeCloseTo(0.3, 5);
  });

  it('update sem tocar em nenhum campo físico nem em packagingId: não recalcula peso', async () => {
    const { service, shippingWeight } = buildService();

    await service.update('tenant-1', 'prod-1', { name: 'Novo nome' });

    expect(shippingWeight.calculate).not.toHaveBeenCalled();
  });

  it('packagingId inválido para o tenant: rejeita antes de chamar o calculador de peso', async () => {
    const { service, packagings, shippingWeight } = buildService();
    packagings.findById.mockResolvedValueOnce(null);

    await expect(service.update('tenant-1', 'prod-1', { packagingId: 'pack-inexistente' })).rejects.toThrow(
      'Embalagem inválida para esta conta.',
    );
    expect(shippingWeight.calculate).not.toHaveBeenCalled();
  });
});
