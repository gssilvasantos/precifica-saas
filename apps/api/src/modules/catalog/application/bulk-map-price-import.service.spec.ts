import { BulkMapPriceImportService } from './bulk-map-price-import.service';
import { ProductRepository } from './ports/product-repository.port';
import { ProductsService } from './products.service';
import { Product } from '../domain/product.entity';

// LIMITAÇÃO CONHECIDA DESTE SANDBOX (mesma de products.service.spec.ts): este
// arquivo importa ProductsService, que importa `Prisma` de '@prisma/client'
// (só para translateError/P2002) — o client Prisma não é gerado neste
// ambiente de verificação, então `tsc --noEmit` aqui aponta esse import como
// erro, igual já documentado para products.service.spec.ts. Não é um erro
// introduzido por este arquivo; é o mesmo gap pré-existente do sandbox.
describe('BulkMapPriceImportService', () => {
  function buildProduct(overrides: Partial<Product> = {}): Product {
    return {
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
      mapPrice: null,
      weightKg: 1,
      packagingWeightKg: 0,
      packedWeightKg: 1,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      cubicWeightKg: 1,
      shippingWeightKg: 1,
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
    } as unknown as Product;
  }

  function buildService(products: Product[]) {
    const productRepo: jest.Mocked<ProductRepository> = {
      create: jest.fn(),
      findAllActive: jest.fn().mockResolvedValue(products),
      findById: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
      findByExternalId: jest.fn(),
    };
    const productsService = {
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ProductsService>;

    const service = new BulkMapPriceImportService(productRepo, productsService);
    return { service, productRepo, productsService };
  }

  const actor = { userId: 'user-1' };

  it('CSV válido: atualiza cada SKU via ProductsService.update com source BULK_IMPORT', async () => {
    const { service, productsService } = buildService([
      buildProduct({ id: 'prod-1', skuCode: 'SKU-001', mapPrice: null }),
      buildProduct({ id: 'prod-2', skuCode: 'SKU-002', mapPrice: 30 }),
    ]);
    const csv = 'sku_code,map_price\nSKU-001,95\nSKU-002,40';

    const summary = await service.importFromCsv('tenant-1', csv, actor);

    expect(summary).toEqual({ totalRows: 2, updated: 2, unchanged: 0, errors: [] });
    expect(productsService.update).toHaveBeenCalledTimes(2);
    expect(productsService.update).toHaveBeenCalledWith('tenant-1', 'prod-1', { mapPrice: 95 }, { userId: 'user-1', source: 'BULK_IMPORT' });
    expect(productsService.update).toHaveBeenCalledWith('tenant-1', 'prod-2', { mapPrice: 40 }, { userId: 'user-1', source: 'BULK_IMPORT' });
  });

  it('linha com map_price igual ao já cadastrado: não chama update, conta como unchanged', async () => {
    const { service, productsService } = buildService([
      buildProduct({ id: 'prod-1', skuCode: 'SKU-001', mapPrice: 95 }),
    ]);
    const csv = 'sku_code,map_price\nSKU-001,95';

    const summary = await service.importFromCsv('tenant-1', csv, actor);

    expect(summary).toEqual({ totalRows: 1, updated: 0, unchanged: 1, errors: [] });
    expect(productsService.update).not.toHaveBeenCalled();
  });

  it('política TUDO-OU-NADA: erro de parsing em UMA linha bloqueia TODAS, nenhum update é chamado', async () => {
    const { service, productsService } = buildService([
      buildProduct({ id: 'prod-1', skuCode: 'SKU-001', mapPrice: null }),
    ]);
    const csv = 'sku_code,map_price\nSKU-001,95\n,40'; // segunda linha: sku_code vazio

    const summary = await service.importFromCsv('tenant-1', csv, actor);

    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(0);
    expect(summary.errors.length).toBeGreaterThan(0);
    expect(productsService.update).not.toHaveBeenCalled();
  });

  it('política TUDO-OU-NADA: SKU inexistente no tenant bloqueia TODAS as linhas, nenhum update é chamado', async () => {
    const { service, productsService } = buildService([
      buildProduct({ id: 'prod-1', skuCode: 'SKU-001', mapPrice: null }),
    ]);
    const csv = 'sku_code,map_price\nSKU-001,95\nSKU-404,40';

    const summary = await service.importFromCsv('tenant-1', csv, actor);

    expect(summary.updated).toBe(0);
    expect(summary.errors).toEqual([{ rowNumber: 2, message: 'SKU SKU-404 não encontrado nesta conta.' }]);
    expect(productsService.update).not.toHaveBeenCalled();
  });

  it('célula map_price vazia: limpa o MAP (mapPrice: null) via o mesmo funil de update', async () => {
    const { service, productsService } = buildService([
      buildProduct({ id: 'prod-1', skuCode: 'SKU-001', mapPrice: 50 }),
    ]);
    const csv = 'sku_code,map_price\nSKU-001,';

    const summary = await service.importFromCsv('tenant-1', csv, actor);

    expect(summary.updated).toBe(1);
    expect(productsService.update).toHaveBeenCalledWith('tenant-1', 'prod-1', { mapPrice: null }, { userId: 'user-1', source: 'BULK_IMPORT' });
  });

  it('busca produtos ativos do tenant certo', async () => {
    const { service, productRepo } = buildService([]);
    const csv = 'sku_code,map_price\nSKU-001,50';

    await service.importFromCsv('tenant-42', csv, actor);

    expect(productRepo.findAllActive).toHaveBeenCalledWith('tenant-42');
  });
});
