import { ProductWarehouseLocationService } from './product-warehouse-location.service';
import { ProductWarehouseLocationRepository } from './ports/product-warehouse-location-repository.port';
import { WarehouseRepository } from './ports/warehouse-repository.port';
import { Warehouse } from '../domain/warehouse.entity';
import { ProductWarehouseLocation } from '../domain/product-warehouse-location.entity';

function buildWarehouse(overrides: Partial<Warehouse> = {}): Warehouse {
  return {
    id: 'wh-1',
    tenantId: 'tenant-1',
    code: 'FISICO',
    type: 'PHYSICAL',
    channelCode: null,
    isActive: true,
    leadTimeDays: 15,
    logisticsCostPerUnit: 0,
  estimatedFreightCost: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildLocation(overrides: Partial<ProductWarehouseLocation> = {}): ProductWarehouseLocation {
  return {
    id: 'loc-1',
    tenantId: 'tenant-1',
    warehouseId: 'wh-1',
    skuCode: 'SKU-1',
    location: 'Corredor 3, Prateleira B',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ProductWarehouseLocationService', () => {
  function buildService() {
    const locations: jest.Mocked<ProductWarehouseLocationRepository> = {
      upsert: jest.fn(),
      findByWarehouse: jest.fn(),
      findOne: jest.fn(),
    };
    const warehouses: jest.Mocked<WarehouseRepository> = {
      findById: jest.fn(),
      findByCode: jest.fn(),
      findAllByTenant: jest.fn(),
      upsert: jest.fn(),
      updateLeadTimeDays: jest.fn(),
      updateLogisticsCostPerUnit: jest.fn(),
    updateEstimatedFreightCost: jest.fn(),
    };
    const service = new ProductWarehouseLocationService(locations, warehouses);
    return { service, locations, warehouses };
  }

  describe('setLocation', () => {
    it('grava quando o depósito pertence ao tenant e a localização é válida', async () => {
      const { service, locations, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'tenant-1' }));
      locations.upsert.mockResolvedValue(buildLocation());

      await service.setLocation('tenant-1', 'wh-1', 'SKU-1', 'Corredor 3, Prateleira B');

      expect(locations.upsert).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        warehouseId: 'wh-1',
        skuCode: 'SKU-1',
        location: 'Corredor 3, Prateleira B',
      });
    });

    it('remove espaços nas pontas antes de gravar', async () => {
      const { service, locations, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'tenant-1' }));
      locations.upsert.mockResolvedValue(buildLocation());

      await service.setLocation('tenant-1', 'wh-1', 'SKU-1', '  Corredor 3  ');

      expect(locations.upsert).toHaveBeenCalledWith(expect.objectContaining({ location: 'Corredor 3' }));
    });

    it('rejeita localização vazia ou só espaço, sem tocar o repositório', async () => {
      const { service, locations } = buildService();
      await expect(service.setLocation('tenant-1', 'wh-1', 'SKU-1', '')).rejects.toThrow();
      await expect(service.setLocation('tenant-1', 'wh-1', 'SKU-1', '   ')).rejects.toThrow();
      expect(locations.upsert).not.toHaveBeenCalled();
    });

    it('rejeita localização acima de 100 caracteres', async () => {
      const { service, locations } = buildService();
      await expect(service.setLocation('tenant-1', 'wh-1', 'SKU-1', 'x'.repeat(101))).rejects.toThrow();
      expect(locations.upsert).not.toHaveBeenCalled();
    });

    it('rejeita depósito de outro tenant (nunca edita posse de terceiro)', async () => {
      const { service, locations, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'outro-tenant' }));

      await expect(service.setLocation('tenant-1', 'wh-1', 'SKU-1', 'Corredor 3')).rejects.toThrow();
      expect(locations.upsert).not.toHaveBeenCalled();
    });

    it('depósito inexistente: lança NotFoundException', async () => {
      const { service, locations, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(null);

      await expect(service.setLocation('tenant-1', 'wh-inexistente', 'SKU-1', 'Corredor 3')).rejects.toThrow();
      expect(locations.upsert).not.toHaveBeenCalled();
    });
  });

  describe('listByWarehouse', () => {
    it('lista quando o depósito pertence ao tenant', async () => {
      const { service, locations, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'tenant-1' }));
      locations.findByWarehouse.mockResolvedValue([buildLocation()]);

      const result = await service.listByWarehouse('tenant-1', 'wh-1');

      expect(result).toHaveLength(1);
      expect(locations.findByWarehouse).toHaveBeenCalledWith('tenant-1', 'wh-1');
    });

    it('rejeita depósito de outro tenant', async () => {
      const { service, locations, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'outro-tenant' }));

      await expect(service.listByWarehouse('tenant-1', 'wh-1')).rejects.toThrow();
      expect(locations.findByWarehouse).not.toHaveBeenCalled();
    });
  });
});
