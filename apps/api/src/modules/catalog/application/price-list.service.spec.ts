import { PriceListService } from './price-list.service';
import { PriceListRepository } from './ports/price-list-repository.port';
import { PriceListExceptionRepository } from './ports/price-list-exception-repository.port';
import { ProductRepository } from './ports/product-repository.port';
import { PriceList, PriceListException } from '../domain/price-list.entity';
import { Product } from '../domain/product.entity';

function buildPriceList(overrides: Partial<PriceList> = {}): PriceList {
  return {
    id: 'pl-1',
    tenantId: 'tenant-1',
    name: 'Lista Atacado',
    adjustmentPct: -10,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildException(overrides: Partial<PriceListException> = {}): PriceListException {
  return {
    id: 'exc-1',
    tenantId: 'tenant-1',
    priceListId: 'pl-1',
    productId: 'prod-1',
    overridePrice: 42,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    tenantId: 'tenant-1',
    skuCode: 'SKU-1',
    name: 'Produto X',
    costPrice: 10,
    isActive: true,
    sourceSystem: 'MANUAL',
    externalId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Product;
}

describe('PriceListService', () => {
  function buildService() {
    const priceLists: jest.Mocked<PriceListRepository> = {
      create: jest.fn(),
      findAllActive: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };
    const exceptions: jest.Mocked<PriceListExceptionRepository> = {
      upsert: jest.fn(),
      findAllByList: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
    };
    const products = {
      create: jest.fn(),
      findAllActive: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
      findByExternalId: jest.fn(),
      findChildren: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    const service = new PriceListService(priceLists, exceptions, products);
    return { service, priceLists, exceptions, products };
  }

  describe('create', () => {
    it('cria uma lista válida', async () => {
      const { service, priceLists } = buildService();
      priceLists.create.mockResolvedValue(buildPriceList());

      const result = await service.create('tenant-1', { name: 'Lista Atacado', adjustmentPct: -10 });

      expect(result.name).toBe('Lista Atacado');
      expect(priceLists.create).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        name: 'Lista Atacado',
        adjustmentPct: -10,
      });
    });

    it('rejeita name vazio', async () => {
      const { service, priceLists } = buildService();
      await expect(service.create('tenant-1', { name: '', adjustmentPct: 10 })).rejects.toThrow();
      expect(priceLists.create).not.toHaveBeenCalled();
    });

    it('rejeita adjustmentPct <= -100', async () => {
      const { service, priceLists } = buildService();
      await expect(service.create('tenant-1', { name: 'x', adjustmentPct: -100 })).rejects.toThrow();
      expect(priceLists.create).not.toHaveBeenCalled();
    });

    it('rejeita adjustmentPct > 1000', async () => {
      const { service, priceLists } = buildService();
      await expect(service.create('tenant-1', { name: 'x', adjustmentPct: 1001 })).rejects.toThrow();
      expect(priceLists.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('atualiza uma lista existente', async () => {
      const { service, priceLists } = buildService();
      priceLists.findById.mockResolvedValue(buildPriceList());
      priceLists.update.mockResolvedValue(buildPriceList({ name: 'Novo nome' }));

      const result = await service.update('tenant-1', 'pl-1', { name: 'Novo nome' });

      expect(result.name).toBe('Novo nome');
    });

    it('lista inexistente: lança NotFoundException', async () => {
      const { service, priceLists } = buildService();
      priceLists.findById.mockResolvedValue(null);

      await expect(service.update('tenant-1', 'pl-x', { name: 'x' })).rejects.toThrow();
      expect(priceLists.update).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('desativa uma lista existente', async () => {
      const { service, priceLists } = buildService();
      priceLists.findById.mockResolvedValue(buildPriceList());
      priceLists.deactivate.mockResolvedValue(buildPriceList({ isActive: false }));

      const result = await service.deactivate('tenant-1', 'pl-1');

      expect(result.isActive).toBe(false);
    });
  });

  describe('setException', () => {
    it('cria a exceção quando lista e produto existem', async () => {
      const { service, priceLists, exceptions, products } = buildService();
      priceLists.findById.mockResolvedValue(buildPriceList());
      products.findById.mockResolvedValue(buildProduct());
      exceptions.upsert.mockResolvedValue(buildException());

      const result = await service.setException('tenant-1', 'pl-1', { productId: 'prod-1', overridePrice: 42 });

      expect(result.overridePrice).toBe(42);
      expect(exceptions.upsert).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        priceListId: 'pl-1',
        productId: 'prod-1',
        overridePrice: 42,
      });
    });

    it('rejeita overridePrice não positivo', async () => {
      const { service, priceLists, exceptions } = buildService();
      priceLists.findById.mockResolvedValue(buildPriceList());

      await expect(
        service.setException('tenant-1', 'pl-1', { productId: 'prod-1', overridePrice: 0 }),
      ).rejects.toThrow();
      expect(exceptions.upsert).not.toHaveBeenCalled();
    });

    it('rejeita produto de outro tenant / inexistente', async () => {
      const { service, priceLists, products, exceptions } = buildService();
      priceLists.findById.mockResolvedValue(buildPriceList());
      products.findById.mockResolvedValue(null);

      await expect(
        service.setException('tenant-1', 'pl-1', { productId: 'prod-inexistente', overridePrice: 42 }),
      ).rejects.toThrow();
      expect(exceptions.upsert).not.toHaveBeenCalled();
    });

    it('lista inexistente: lança NotFoundException', async () => {
      const { service, priceLists } = buildService();
      priceLists.findById.mockResolvedValue(null);

      await expect(
        service.setException('tenant-1', 'pl-x', { productId: 'prod-1', overridePrice: 42 }),
      ).rejects.toThrow();
    });
  });

  describe('listExceptions / removeException', () => {
    it('lista as exceções de uma lista existente', async () => {
      const { service, priceLists, exceptions } = buildService();
      priceLists.findById.mockResolvedValue(buildPriceList());
      exceptions.findAllByList.mockResolvedValue([buildException()]);

      const result = await service.listExceptions('tenant-1', 'pl-1');

      expect(result).toHaveLength(1);
    });

    it('remove uma exceção existente', async () => {
      const { service, priceLists, exceptions } = buildService();
      priceLists.findById.mockResolvedValue(buildPriceList());
      exceptions.findOne.mockResolvedValue(buildException());

      await service.removeException('tenant-1', 'pl-1', 'prod-1');

      expect(exceptions.remove).toHaveBeenCalledWith('exc-1');
    });

    it('rejeita remover exceção inexistente', async () => {
      const { service, priceLists, exceptions } = buildService();
      priceLists.findById.mockResolvedValue(buildPriceList());
      exceptions.findOne.mockResolvedValue(null);

      await expect(service.removeException('tenant-1', 'pl-1', 'prod-x')).rejects.toThrow();
      expect(exceptions.remove).not.toHaveBeenCalled();
    });
  });

  describe('resolvePrice', () => {
    it('aplica o percentual da lista quando não há exceção', async () => {
      const { service, priceLists, exceptions } = buildService();
      priceLists.findById.mockResolvedValue(buildPriceList({ adjustmentPct: -10 }));
      exceptions.findOne.mockResolvedValue(null);

      const result = await service.resolvePrice('tenant-1', 'pl-1', 'prod-1', 100);

      expect(result).toBe(90);
    });

    it('a exceção sempre vence sobre o percentual', async () => {
      const { service, priceLists, exceptions } = buildService();
      priceLists.findById.mockResolvedValue(buildPriceList({ adjustmentPct: -10 }));
      exceptions.findOne.mockResolvedValue(buildException({ overridePrice: 77 }));

      const result = await service.resolvePrice('tenant-1', 'pl-1', 'prod-1', 100);

      expect(result).toBe(77);
    });
  });
});
