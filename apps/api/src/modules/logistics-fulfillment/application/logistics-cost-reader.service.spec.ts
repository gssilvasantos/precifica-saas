import { LogisticsCostReaderService } from './logistics-cost-reader.service';
import { WarehouseService } from './warehouse.service';
import { WarehouseRepository } from './ports/warehouse-repository.port';
import { ProductCatalogReader, ProductCatalogSummary } from '../../../shared/contracts/product-catalog-reader.port';
import { PackagingCostReader, PackagingCostSummary } from '../../../shared/contracts/packaging-cost-reader.port';
import { Warehouse } from '../domain/warehouse.entity';

function buildProduct(overrides: Partial<ProductCatalogSummary> = {}): ProductCatalogSummary {
  return {
    productId: 'prod-1',
    skuCode: 'SKU-1',
    name: 'Produto',
    costPrice: 50,
    productCostPrice: 50,
    packagingCostPrice: 5,
    desiredMarginPct: 20,
    minimumMarginPct: 8,
    autoRepricingEnabled: false,
    packagingId: 'pack-1',
    isKit: false,
    mapPrice: null,
    ...overrides,
  };
}

function buildPackagingCost(overrides: Partial<PackagingCostSummary> = {}): PackagingCostSummary {
  return {
    id: 'pack-1',
    costPrice: 5,
    purpose: 'STANDARD',
    maxCapacityKg: null,
    ...overrides,
  };
}

function buildWarehouse(overrides: Partial<Warehouse> = {}): Warehouse {
  return {
    id: 'wh-full',
    tenantId: 'tenant-1',
    code: 'CD_FULL_NUVEMSHOP',
    type: 'VIRTUAL_FULL',
    channelCode: 'NUVEMSHOP',
    isActive: true,
    leadTimeDays: 15,
    logisticsCostPerUnit: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Motor de custo logístico (Sprint 26) — hierarquia de embalagem (kit ->
// vínculo individual -> default de segurança) + custo operacional do
// Warehouse Full. Ver docs/promotion-intelligence-architecture.md.
describe('LogisticsCostReaderService', () => {
  function buildService(
    product: ProductCatalogSummary | null,
    packagingOverrides: { grouping?: PackagingCostSummary | null; safetyDefault?: PackagingCostSummary | null; masters?: PackagingCostSummary[] } = {},
  ) {
    const catalog: jest.Mocked<ProductCatalogReader> = {
      findBySku: jest.fn().mockResolvedValue(product),
    };
    const packagingCosts: jest.Mocked<PackagingCostReader> = {
      findById: jest.fn().mockResolvedValue(packagingOverrides.grouping ?? null),
      findSafetyDefault: jest.fn().mockResolvedValue(packagingOverrides.safetyDefault ?? null),
      findAllMaster: jest.fn().mockResolvedValue(packagingOverrides.masters ?? []),
    };
    const warehouseRepo: jest.Mocked<WarehouseRepository> = {
      findById: jest.fn(),
      findByCode: jest.fn().mockResolvedValue(buildWarehouse()),
      findAllByTenant: jest.fn(),
      upsert: jest.fn(),
      updateLeadTimeDays: jest.fn(),
      updateLogisticsCostPerUnit: jest.fn(),
    };
    const warehouses = new WarehouseService(warehouseRepo);
    const service = new LogisticsCostReaderService(catalog, packagingCosts, warehouses);
    return { service, catalog, packagingCosts, warehouseRepo };
  }

  describe('getTotalLogisticsCost', () => {
    it('soma o custo de embalagem (vínculo individual) + custo operacional do Warehouse Full', async () => {
      const { service } = buildService(buildProduct({ packagingCostPrice: 5 }));

      const total = await service.getTotalLogisticsCost('tenant-1', 'SKU-1', 'NUVEMSHOP');

      // packagingCostPrice (5) + Warehouse.logisticsCostPerUnit (2)
      expect(total).toBe(7);
    });

    it('Prioridade 1 (kit): usa a Embalagem de Agrupamento, não o vínculo individual', async () => {
      const { service, packagingCosts } = buildService(
        buildProduct({ isKit: true, packagingId: 'pack-grouping', packagingCostPrice: 5 }),
        { grouping: buildPackagingCost({ id: 'pack-grouping', costPrice: 20, purpose: 'GROUPING' }) },
      );

      const total = await service.getTotalLogisticsCost('tenant-1', 'SKU-KIT', 'NUVEMSHOP');

      expect(packagingCosts.findById).toHaveBeenCalledWith('tenant-1', 'pack-grouping');
      // custo do GROUPING (20), não o packagingCostPrice individual (5), + operacional (2)
      expect(total).toBe(22);
    });

    it('Prioridade 3 (default de segurança): sem embalagem vinculada, usa a SAFETY_DEFAULT do tenant', async () => {
      const { service } = buildService(buildProduct({ packagingId: null, packagingCostPrice: null }), {
        safetyDefault: buildPackagingCost({ id: 'pack-safety', costPrice: 15, purpose: 'SAFETY_DEFAULT' }),
      });

      const total = await service.getTotalLogisticsCost('tenant-1', 'SKU-1', 'NUVEMSHOP');

      expect(total).toBe(17); // 15 (safety default) + 2 (operacional)
    });

    it('sem embalagem vinculada e sem default de segurança cadastrado: custo de embalagem assume 0 (nunca fabrica um valor)', async () => {
      const { service } = buildService(buildProduct({ packagingId: null, packagingCostPrice: null }));

      const total = await service.getTotalLogisticsCost('tenant-1', 'SKU-1', 'NUVEMSHOP');

      expect(total).toBe(2); // só o operacional
    });

    it('kit sem Embalagem de Agrupamento resolvida: cai para o vínculo individual (não quebra)', async () => {
      const { service } = buildService(
        buildProduct({ isKit: true, packagingId: 'pack-inexistente', packagingCostPrice: 5 }),
        { grouping: null },
      );

      const total = await service.getTotalLogisticsCost('tenant-1', 'SKU-KIT', 'NUVEMSHOP');

      expect(total).toBe(7); // 5 (vínculo individual) + 2 (operacional)
    });

    it('SKU inexistente no catálogo: custo de embalagem 0, só soma o operacional', async () => {
      const { service } = buildService(null);

      const total = await service.getTotalLogisticsCost('tenant-1', 'SKU-FANTASMA', 'NUVEMSHOP');

      expect(total).toBe(2);
    });
  });

  describe('getPackagingCostForOrder (Prioridade 2 — sem consumidor nesta sprint)', () => {
    it('sem Embalagem Master cadastrada: cai para a SAFETY_DEFAULT', async () => {
      const { service } = buildService(null, { masters: [], safetyDefault: buildPackagingCost({ costPrice: 15 }) });

      const cost = await service.getPackagingCostForOrder('tenant-1', [{ skuCode: 'SKU-1', quantity: 2 }]);

      expect(cost).toBe(15);
    });

    it('com Embalagem Master cadastrada: usa a primeira (aproximação conservadora)', async () => {
      const { service } = buildService(null, {
        masters: [buildPackagingCost({ id: 'master-1', costPrice: 30, purpose: 'MASTER', maxCapacityKg: 10 })],
      });

      const cost = await service.getPackagingCostForOrder('tenant-1', [{ skuCode: 'SKU-1', quantity: 2 }]);

      expect(cost).toBe(30);
    });
  });
});
