import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductLotService } from './product-lot.service';
import { ProductRepository } from './ports/product-repository.port';
import { ProductLotRepository } from './ports/product-lot-repository.port';
import { Product } from '../domain/product.entity';
import { ProductLot } from '../domain/product-lot';

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    tenantId: 'tenant-1',
    skuCode: 'SKU-1',
    name: 'Iogurte',
    internalCategory: null,
    categoryId: null,
    supplierId: null,
    taxProfileId: null,
    packagingId: null,
    isKit: false,
    controlaLote: true,
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

function buildLot(overrides: Partial<ProductLot> = {}): ProductLot {
  return {
    id: 'lot-1',
    tenantId: 'tenant-1',
    skuCode: 'SKU-1',
    lotCode: 'L1',
    dataFabricacao: null,
    dataValidade: new Date('2026-12-01'),
    diasPermitidoVenda: 0,
    codigoAgregacao: null,
    status: 'ATIVO',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ProductLotService', () => {
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
    const lots: jest.Mocked<ProductLotRepository> = {
      create: jest.fn(),
      findByTenantAndSku: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn(),
    };
    const service = new ProductLotService(products, lots);
    return { service, products, lots };
  }

  describe('create', () => {
    it('rejeita produto não encontrado', async () => {
      const { service } = buildService(null);
      await expect(
        service.create('tenant-1', 'product-1', { lotCode: 'L1', dataValidade: new Date('2026-12-01') }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejeita produto sem controlaLote', async () => {
      const { service } = buildService(buildProduct({ controlaLote: false }));
      await expect(
        service.create('tenant-1', 'product-1', { lotCode: 'L1', dataValidade: new Date('2026-12-01') }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita dados de lote inválidos (lotCode vazio)', async () => {
      const { service } = buildService(buildProduct());
      await expect(service.create('tenant-1', 'product-1', { lotCode: '', dataValidade: new Date('2026-12-01') })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejeita lotCode duplicado para o mesmo SKU', async () => {
      const { service, lots } = buildService(buildProduct());
      lots.findOne.mockResolvedValue(buildLot());
      await expect(service.create('tenant-1', 'product-1', { lotCode: 'L1', dataValidade: new Date('2026-12-01') })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('cria o lote com skuCode resolvido do produto', async () => {
      const { service, lots } = buildService(buildProduct({ skuCode: 'SKU-1' }));
      const lot = buildLot();
      lots.create.mockResolvedValue(lot);

      const result = await service.create('tenant-1', 'product-1', {
        lotCode: 'L1',
        dataValidade: new Date('2026-12-01'),
        diasPermitidoVenda: 15,
      });

      expect(lots.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', skuCode: 'SKU-1', lotCode: 'L1', diasPermitidoVenda: 15 }),
      );
      expect(result).toEqual(lot);
    });
  });

  describe('listByProductId', () => {
    it('resolve o skuCode do produto e busca os lotes', async () => {
      const { service, lots } = buildService(buildProduct({ skuCode: 'SKU-1' }));
      const lot = buildLot();
      lots.findByTenantAndSku.mockResolvedValue([lot]);

      const result = await service.listByProductId('tenant-1', 'product-1');

      expect(lots.findByTenantAndSku).toHaveBeenCalledWith('tenant-1', 'SKU-1');
      expect(result).toEqual([lot]);
    });
  });

  describe('updateStatus', () => {
    it('rejeita lote não encontrado', async () => {
      const { service } = buildService(buildProduct());
      await expect(service.updateStatus('tenant-1', 'product-1', 'L1', 'INATIVO')).rejects.toThrow(NotFoundException);
    });

    it('atualiza o status do lote', async () => {
      const { service, lots } = buildService(buildProduct());
      const lot = buildLot();
      lots.findOne.mockResolvedValue(lot);
      lots.updateStatus.mockResolvedValue({ ...lot, status: 'INATIVO' });

      const result = await service.updateStatus('tenant-1', 'product-1', 'L1', 'INATIVO');

      expect(lots.updateStatus).toHaveBeenCalledWith('lot-1', 'INATIVO');
      expect(result.status).toBe('INATIVO');
    });
  });

  describe('getLots / findLot (ProductLotReader)', () => {
    it('getLots devolve metadado por skuCode direto, sem passar pelo produto', async () => {
      const { service, lots } = buildService(null);
      lots.findByTenantAndSku.mockResolvedValue([buildLot({ lotCode: 'L9', diasPermitidoVenda: 7 })]);

      const result = await service.getLots('tenant-1', 'SKU-1');

      expect(lots.findByTenantAndSku).toHaveBeenCalledWith('tenant-1', 'SKU-1');
      expect(result).toEqual([{ lotCode: 'L9', dataValidade: new Date('2026-12-01'), diasPermitidoVenda: 7, status: 'ATIVO' }]);
    });

    it('findLot devolve null quando o lote não existe', async () => {
      const { service, lots } = buildService(null);
      lots.findOne.mockResolvedValue(null);

      const result = await service.findLot('tenant-1', 'SKU-1', 'L1');

      expect(result).toBeNull();
    });
  });
});
