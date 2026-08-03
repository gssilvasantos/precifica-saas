import { ProductsService } from './products.service';
import { ProductRepository } from './ports/product-repository.port';
import { SupplierRepository } from './ports/supplier-repository.port';
import { TaxProfileRepository } from './ports/tax-profile-repository.port';
import { PackagingRepository } from './ports/packaging-repository.port';
import { ProductCategoryRepository } from './ports/product-category-repository.port';
import { ShippingWeightCalculator, PackageWeightResult } from '../../../shared/contracts/shipping-weight-calculator.port';
import { Product } from '../domain/product.entity';
import { Packaging } from '../domain/packaging.entity';
import { ProductAuditLogService } from './product-audit-log.service';

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
    categoryId: null,
    supplierId: null,
    taxProfileId: null,
    packagingId: null,
    isKit: false,
    controlaLote: false,
    parentProductId: null,
    variantAttributes: null,
    mapPrice: null,
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
      findChildren: jest.fn().mockResolvedValue([]),
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
    const categories = { findById: jest.fn() } as unknown as jest.Mocked<ProductCategoryRepository>;
    const shippingWeight: jest.Mocked<ShippingWeightCalculator> = {
      calculate: jest.fn().mockResolvedValue(weightResult),
    };
    const auditLog = { record: jest.fn(), listForProduct: jest.fn() } as unknown as jest.Mocked<ProductAuditLogService>;

    const service = new ProductsService(products, suppliers, taxProfiles, packagings, categories, shippingWeight, auditLog);
    return { service, products, packagings, shippingWeight, auditLog };
  }

  const actor = { userId: 'user-1' };

  it('trocar só o packagingId (nenhum campo físico) ainda dispara recálculo de peso usando as dimensões da nova embalagem', async () => {
    const { service, packagings, shippingWeight } = buildService();

    await service.update('tenant-1', 'prod-1', { packagingId: 'pack-1' }, actor);

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

    await service.update('tenant-1', 'prod-1', { name: 'Novo nome' }, actor);

    expect(shippingWeight.calculate).not.toHaveBeenCalled();
  });

  it('packagingId inválido para o tenant: rejeita antes de chamar o calculador de peso', async () => {
    const { service, packagings, shippingWeight } = buildService();
    packagings.findById.mockResolvedValueOnce(null);

    await expect(service.update('tenant-1', 'prod-1', { packagingId: 'pack-inexistente' }, actor)).rejects.toThrow(
      'Embalagem inválida para esta conta.',
    );
    expect(shippingWeight.calculate).not.toHaveBeenCalled();
  });
});

// Produto Pai + Variação (Fase 2, benchmark Tiny ERP, 28/07/2026) — foco:
// o gate canSetParent (domain/product-variant.ts) chamado a partir do
// service, com o contexto (pai candidato + filhos existentes) montado
// corretamente para create() e update().
describe('ProductsService (Produto Pai + Variação)', () => {
  const baseProduct: Product = {
    id: 'prod-1',
    tenantId: 'tenant-1',
    skuCode: 'SKU-001',
    name: 'Camiseta Azul P',
    internalCategory: null,
    categoryId: null,
    supplierId: null,
    taxProfileId: null,
    packagingId: null,
    isKit: false,
    controlaLote: false,
    parentProductId: null,
    variantAttributes: null,
    mapPrice: null,
    costPrice: 60,
    desiredMarginPct: 30,
    minimumMarginPct: 20,
    autoRepricingEnabled: false,
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
  };

  const parentProduct: Product = { ...baseProduct, id: 'parent-1', skuCode: 'CAMISETA-AZUL', name: 'Camiseta Azul' };
  const weightResult: PackageWeightResult = { packedWeightKg: 1, cubicWeightKg: 1, shippingWeightKg: 1 };
  const actor = { userId: 'user-1' };

  const createInput = {
    skuCode: 'SKU-002',
    name: 'Camiseta Azul M',
    costPrice: 60,
    desiredMarginPct: 30,
    minimumMarginPct: 20,
    weightKg: 1,
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
  };

  function buildService(productsById: Record<string, Product | null>) {
    const products: jest.Mocked<ProductRepository> = {
      create: jest.fn().mockImplementation(async (data) => ({ ...baseProduct, id: 'new-prod', ...data }) as Product),
      findAllActive: jest.fn(),
      findById: jest.fn().mockImplementation(async (_tenantId: string, id: string) => productsById[id] ?? null),
      update: jest.fn().mockImplementation(async (id, data) => ({ ...baseProduct, id, ...data }) as Product),
      deactivate: jest.fn(),
      findByExternalId: jest.fn(),
      findChildren: jest.fn().mockResolvedValue([]),
    };
    const suppliers = {} as jest.Mocked<SupplierRepository>;
    const taxProfiles = {} as jest.Mocked<TaxProfileRepository>;
    const packagings = { findById: jest.fn() } as unknown as jest.Mocked<PackagingRepository>;
    const categories = { findById: jest.fn() } as unknown as jest.Mocked<ProductCategoryRepository>;
    const shippingWeight: jest.Mocked<ShippingWeightCalculator> = {
      calculate: jest.fn().mockResolvedValue(weightResult),
    };
    const auditLog = { record: jest.fn(), listForProduct: jest.fn() } as unknown as jest.Mocked<ProductAuditLogService>;

    const service = new ProductsService(products, suppliers, taxProfiles, packagings, categories, shippingWeight, auditLog);
    return { service, products };
  }

  describe('create', () => {
    it('cria a variação quando o pai existe, não é ele mesmo uma variação, e a grade de atributos é válida', async () => {
      const { service, products } = buildService({ 'parent-1': parentProduct });

      const result = await service.create('tenant-1', {
        ...createInput,
        parentProductId: 'parent-1',
        variantAttributes: { Cor: 'Azul', Tamanho: 'M' },
      });

      expect(result.parentProductId).toBe('parent-1');
      expect(products.create).toHaveBeenCalledWith(
        expect.objectContaining({ parentProductId: 'parent-1', variantAttributes: { Cor: 'Azul', Tamanho: 'M' } }),
      );
    });

    it('rejeita quando o pai informado não existe para o tenant', async () => {
      const { service, products } = buildService({});

      await expect(
        service.create('tenant-1', { ...createInput, parentProductId: 'parent-inexistente', variantAttributes: { Cor: 'Azul' } }),
      ).rejects.toThrow('não encontrado');
      expect(products.create).not.toHaveBeenCalled();
    });

    it('rejeita quando o produto escolhido como pai já é ele mesmo uma variação', async () => {
      const grandparentIsVariant = { ...parentProduct, parentProductId: 'algum-outro-pai' };
      const { service, products } = buildService({ 'parent-1': grandparentIsVariant });

      await expect(
        service.create('tenant-1', { ...createInput, parentProductId: 'parent-1', variantAttributes: { Cor: 'Azul' } }),
      ).rejects.toThrow('hierarquia limitada a um nível');
      expect(products.create).not.toHaveBeenCalled();
    });

    it('rejeita quando variantAttributes não é informado', async () => {
      const { service, products } = buildService({ 'parent-1': parentProduct });

      await expect(service.create('tenant-1', { ...createInput, parentProductId: 'parent-1' })).rejects.toThrow(
        'variantAttributes',
      );
      expect(products.create).not.toHaveBeenCalled();
    });

    it('rejeita quando variantAttributes é um objeto vazio', async () => {
      const { service, products } = buildService({ 'parent-1': parentProduct });

      await expect(
        service.create('tenant-1', { ...createInput, parentProductId: 'parent-1', variantAttributes: {} }),
      ).rejects.toThrow('variantAttributes');
      expect(products.create).not.toHaveBeenCalled();
    });

    it('produto normal (sem parentProductId) não roda o gate de variação', async () => {
      const { service, products } = buildService({});

      await service.create('tenant-1', createInput);

      expect(products.create).toHaveBeenCalledWith(expect.objectContaining({ parentProductId: null }));
    });
  });

  describe('update', () => {
    it('vincula um produto existente a um pai válido', async () => {
      const { service } = buildService({ 'prod-1': baseProduct, 'parent-1': parentProduct });

      const result = await service.update(
        'tenant-1',
        'prod-1',
        { parentProductId: 'parent-1', variantAttributes: { Cor: 'Azul', Tamanho: 'P' } },
        actor,
      );

      expect(result.parentProductId).toBe('parent-1');
    });

    it('rejeita auto-referência (produto virando pai de si mesmo)', async () => {
      const { service } = buildService({ 'prod-1': baseProduct });

      await expect(
        service.update('tenant-1', 'prod-1', { parentProductId: 'prod-1', variantAttributes: { Cor: 'Azul' } }, actor),
      ).rejects.toThrow('si mesmo');
    });

    it('rejeita quando o produto que está virando variação já tem filhos', async () => {
      const { service, products } = buildService({ 'prod-1': baseProduct, 'parent-1': parentProduct });
      products.findChildren.mockResolvedValueOnce([{ ...baseProduct, id: 'child-1', parentProductId: 'prod-1' }]);

      await expect(
        service.update('tenant-1', 'prod-1', { parentProductId: 'parent-1', variantAttributes: { Cor: 'Azul' } }, actor),
      ).rejects.toThrow('já tem variações');
    });

    it('desvincular do pai (parentProductId: null) é sempre permitido, sem gate', async () => {
      const variantProduct = { ...baseProduct, parentProductId: 'parent-1', variantAttributes: { Cor: 'Azul' } };
      const { service, products } = buildService({ 'prod-1': variantProduct });

      const result = await service.update('tenant-1', 'prod-1', { parentProductId: null }, actor);

      // Gate não roda quando parentProductId é null explícito (desvincular
      // nunca quebra a hierarquia de ninguém) — findChildren não é chamado.
      expect(products.findChildren).not.toHaveBeenCalled();
      expect(result.parentProductId).toBeNull();
    });

    it('sem variantAttributes reenviado e sem grade prévia, rejeita (grade obrigatória)', async () => {
      const { service, products } = buildService({ 'prod-1': baseProduct, 'parent-1': parentProduct });

      // baseProduct.variantAttributes é null -> sem override nesta chamada,
      // o efetivo continua null -> assertValidParentAssignment rejeita.
      await expect(service.update('tenant-1', 'prod-1', { parentProductId: 'parent-1' }, actor)).rejects.toThrow(
        'variantAttributes',
      );
      expect(products.update).not.toHaveBeenCalled();
    });

    it('reaproveita a grade de atributos JÁ EXISTENTE quando não reenviada nesta chamada', async () => {
      const alreadyVariant = { ...baseProduct, variantAttributes: { Cor: 'Azul' } };
      const { service, products } = buildService({ 'prod-1': alreadyVariant, 'parent-1': parentProduct });

      await service.update('tenant-1', 'prod-1', { parentProductId: 'parent-1' }, actor);

      expect(products.update).toHaveBeenCalled();
    });
  });

  describe('findVariants', () => {
    it('lista as variações depois de confirmar que o produto pertence ao tenant', async () => {
      const variant = { ...baseProduct, id: 'child-1', parentProductId: 'parent-1' };
      const { service, products } = buildService({ 'parent-1': parentProduct });
      products.findChildren.mockResolvedValueOnce([variant]);

      const result = await service.findVariants('tenant-1', 'parent-1');

      expect(products.findById).toHaveBeenCalledWith('tenant-1', 'parent-1');
      expect(products.findChildren).toHaveBeenCalledWith('tenant-1', 'parent-1');
      expect(result).toEqual([variant]);
    });

    it('lança NotFoundException quando o produto não existe no tenant', async () => {
      const { service } = buildService({});

      await expect(service.findVariants('tenant-1', 'inexistente')).rejects.toThrow('não encontrado');
    });
  });

  // Quick Win 5 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 1.5) — geração automática de combinações de variação a partir do
  // produto pai.
  describe('generateVariantCombinations', () => {
    it('gera uma variação por combinação, herdando dados do pai', async () => {
      const { service, products } = buildService({ 'parent-1': parentProduct });

      const result = await service.generateVariantCombinations('tenant-1', 'parent-1', [
        { name: 'Cor', options: ['Azul', 'Verde'] },
        { name: 'Tamanho', options: ['P', 'M'] },
      ]);

      expect(result).toHaveLength(4);
      expect(products.create).toHaveBeenCalledTimes(4);
      expect(products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          skuCode: 'CAMISETA-AZUL-AZUL-P',
          name: 'Camiseta Azul (Azul / P)',
          parentProductId: 'parent-1',
          variantAttributes: { Cor: 'Azul', Tamanho: 'P' },
          costPrice: parentProduct.costPrice,
          desiredMarginPct: parentProduct.desiredMarginPct,
          minimumMarginPct: parentProduct.minimumMarginPct,
          weightKg: parentProduct.weightKg,
          lengthCm: parentProduct.lengthCm,
          widthCm: parentProduct.widthCm,
          heightCm: parentProduct.heightCm,
        }),
      );
    });

    it('rejeita quando o produto informado não existe no tenant', async () => {
      const { service, products } = buildService({});

      await expect(
        service.generateVariantCombinations('tenant-1', 'inexistente', [{ name: 'Cor', options: ['Azul'] }]),
      ).rejects.toThrow('não encontrado');
      expect(products.create).not.toHaveBeenCalled();
    });

    it('rejeita quando o produto informado já é ele mesmo uma variação', async () => {
      const alreadyVariant = { ...parentProduct, parentProductId: 'avo-1' };
      const { service, products } = buildService({ 'parent-1': alreadyVariant });

      await expect(
        service.generateVariantCombinations('tenant-1', 'parent-1', [{ name: 'Cor', options: ['Azul'] }]),
      ).rejects.toThrow('produto pai');
      expect(products.create).not.toHaveBeenCalled();
    });

    it('rejeita grade de atributos vazia', async () => {
      const { service, products } = buildService({ 'parent-1': parentProduct });

      await expect(service.generateVariantCombinations('tenant-1', 'parent-1', [])).rejects.toThrow(
        'ao menos um atributo',
      );
      expect(products.create).not.toHaveBeenCalled();
    });

    it('rejeita atributo com opção em branco', async () => {
      const { service, products } = buildService({ 'parent-1': parentProduct });

      await expect(
        service.generateVariantCombinations('tenant-1', 'parent-1', [{ name: 'Cor', options: ['Azul', '  '] }]),
      ).rejects.toThrow('ao menos um atributo');
      expect(products.create).not.toHaveBeenCalled();
    });

    it('rejeita quando a grade gera SKUs duplicados', async () => {
      const { service, products } = buildService({ 'parent-1': parentProduct });

      await expect(
        service.generateVariantCombinations('tenant-1', 'parent-1', [{ name: 'Cor', options: ['Azul', 'AZUL'] }]),
      ).rejects.toThrow('SKUs duplicados');
      expect(products.create).not.toHaveBeenCalled();
    });
  });
});
