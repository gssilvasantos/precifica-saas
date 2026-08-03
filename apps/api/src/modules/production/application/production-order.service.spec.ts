import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductionOrderService } from './production-order.service';
import { ProductionOrderRepository } from './ports/production-order-repository.port';
import { ProductCatalogReader, ProductCatalogSummary } from '../../../shared/contracts/product-catalog-reader.port';
import { ProductStructureReader } from '../../../shared/contracts/product-structure-reader.port';
import { ProductionStockWriter } from '../../../shared/contracts/production-stock-writer.port';
import { WarehouseRepository } from '../../logistics-fulfillment/application/ports/warehouse-repository.port';
import { ProductionOrder } from '../domain/production-order.entity';

function buildParent(overrides: Partial<ProductCatalogSummary> = {}): ProductCatalogSummary {
  return {
    productId: 'product-1',
    skuCode: 'KIT-1',
    name: 'Kit Presente',
    costPrice: 10,
    productCostPrice: 10,
    packagingCostPrice: null,
    desiredMarginPct: 30,
    minimumMarginPct: 10,
    autoRepricingEnabled: false,
    packagingId: null,
    isKit: true,
    mapPrice: null,
    ncm: null,
    fiscalOriginCode: null,
    cest: null,
    categoryId: null,
    photoUrls: [],
    weightKg: 1,
    ...overrides,
  };
}

function buildOrder(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    id: 'po-1',
    tenantId: 'tenant-1',
    status: 'RASCUNHO',
    parentSkuCode: 'KIT-1',
    quantity: 10,
    sourceWarehouseId: 'wh-physical',
    destinationWarehouseId: 'wh-physical',
    notes: null,
    concludedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    components: [
      {
        id: 'comp-1',
        tenantId: 'tenant-1',
        productionOrderId: 'po-1',
        componentSkuCode: 'COMP-1',
        quantityPerUnit: 2,
        totalQuantity: 20,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    ...overrides,
  };
}

describe('ProductionOrderService', () => {
  function buildService(order: ProductionOrder | null) {
    const orders: jest.Mocked<ProductionOrderRepository> = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(order),
      findAllByTenant: jest.fn().mockResolvedValue([]),
      updateStatus: jest.fn(),
      markConcluded: jest.fn(),
    };
    const catalog: jest.Mocked<ProductCatalogReader> = {
      findBySku: jest.fn().mockResolvedValue(buildParent()),
    };
    const structures: jest.Mocked<ProductStructureReader> = {
      getComponents: jest.fn().mockResolvedValue([{ componentSkuCode: 'COMP-1', quantity: 2 }]),
    };
    const warehouses: jest.Mocked<WarehouseRepository> = {
      findById: jest.fn().mockResolvedValue({ id: 'wh-physical', tenantId: 'tenant-1' } as any),
      findByCode: jest.fn(),
      findAllByTenant: jest.fn(),
      upsert: jest.fn(),
      updateLeadTimeDays: jest.fn(),
      updateLogisticsCostPerUnit: jest.fn(),
    updateEstimatedFreightCost: jest.fn(),
    };
    const stockWriter: jest.Mocked<ProductionStockWriter> = {
      produceOutput: jest.fn().mockResolvedValue({ auditEventId: 'audit-1' }),
    };
    const service = new ProductionOrderService(orders, catalog, structures, warehouses, stockWriter);
    return { service, orders, catalog, structures, warehouses, stockWriter };
  }

  describe('create', () => {
    it('rejeita quantity não inteira/positiva', async () => {
      const { service } = buildService(null);
      await expect(
        service.create('tenant-1', { parentSkuCode: 'KIT-1', quantity: 0, sourceWarehouseId: 'wh-physical', destinationWarehouseId: 'wh-physical' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita produto pai não encontrado', async () => {
      const { service, catalog } = buildService(null);
      catalog.findBySku.mockResolvedValue(null);
      await expect(
        service.create('tenant-1', { parentSkuCode: 'KIT-X', quantity: 1, sourceWarehouseId: 'wh-physical', destinationWarehouseId: 'wh-physical' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita produto pai que não é kit', async () => {
      const { service, catalog } = buildService(null);
      catalog.findBySku.mockResolvedValue(buildParent({ isKit: false }));
      await expect(
        service.create('tenant-1', { parentSkuCode: 'KIT-1', quantity: 1, sourceWarehouseId: 'wh-physical', destinationWarehouseId: 'wh-physical' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita depósito que não pertence ao tenant', async () => {
      const { service, warehouses } = buildService(null);
      warehouses.findById.mockResolvedValue(null);
      await expect(
        service.create('tenant-1', { parentSkuCode: 'KIT-1', quantity: 1, sourceWarehouseId: 'wh-x', destinationWarehouseId: 'wh-x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita produto sem BOM cadastrada', async () => {
      const { service, structures } = buildService(null);
      structures.getComponents.mockResolvedValue([]);
      await expect(
        service.create('tenant-1', { parentSkuCode: 'KIT-1', quantity: 1, sourceWarehouseId: 'wh-physical', destinationWarehouseId: 'wh-physical' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('resolve o requisito de componentes (snapshot) e cria a ordem', async () => {
      const { service, orders } = buildService(null);
      orders.create.mockResolvedValue(buildOrder());

      await service.create('tenant-1', {
        parentSkuCode: 'KIT-1',
        quantity: 10,
        sourceWarehouseId: 'wh-physical',
        destinationWarehouseId: 'wh-physical',
      });

      expect(orders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          parentSkuCode: 'KIT-1',
          quantity: 10,
          components: [{ componentSkuCode: 'COMP-1', quantityPerUnit: 2, totalQuantity: 20 }],
        }),
      );
    });
  });

  describe('start/cancel', () => {
    it('start: RASCUNHO -> EM_ANDAMENTO', async () => {
      const { service, orders } = buildService(buildOrder({ status: 'RASCUNHO' }));
      orders.updateStatus.mockResolvedValue(buildOrder({ status: 'EM_ANDAMENTO' }));
      const result = await service.start('tenant-1', 'po-1');
      expect(orders.updateStatus).toHaveBeenCalledWith('po-1', 'EM_ANDAMENTO');
      expect(result.status).toBe('EM_ANDAMENTO');
    });

    it('cancel: nunca cancela CONCLUIDA', async () => {
      const { service } = buildService(buildOrder({ status: 'CONCLUIDA' }));
      await expect(service.cancel('tenant-1', 'po-1')).rejects.toThrow(BadRequestException);
    });

    it('findOne: propaga NotFoundException quando não existe', async () => {
      const { service } = buildService(null);
      await expect(service.findOne('tenant-1', 'po-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('conclude', () => {
    it('debita componentes + credita produto acabado, então marca CONCLUIDA', async () => {
      const order = buildOrder({ status: 'RASCUNHO' });
      const { service, orders, stockWriter } = buildService(order);
      orders.markConcluded.mockResolvedValue({ ...order, status: 'CONCLUIDA', concludedAt: new Date() });

      const result = await service.conclude('tenant-1', 'po-1', 'user-1');

      expect(stockWriter.produceOutput).toHaveBeenCalledWith(
        'tenant-1',
        'wh-physical',
        'wh-physical',
        'user-1',
        [{ skuCode: 'COMP-1', quantity: 20 }],
        { skuCode: 'KIT-1', quantity: 10 },
      );
      expect(orders.markConcluded).toHaveBeenCalledWith('po-1', expect.objectContaining({ status: 'CONCLUIDA' }));
      expect(result.status).toBe('CONCLUIDA');
    });

    it('nunca marca CONCLUIDA se o gate recusar (ordem já concluída)', async () => {
      const order = buildOrder({ status: 'CONCLUIDA' });
      const { service, stockWriter } = buildService(order);
      await expect(service.conclude('tenant-1', 'po-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(stockWriter.produceOutput).not.toHaveBeenCalled();
    });
  });
});
