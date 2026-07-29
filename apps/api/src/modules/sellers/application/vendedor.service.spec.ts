import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VendedorService } from './vendedor.service';
import { VendedorRepository } from './ports/vendedor-repository.port';
import { Vendedor } from '../domain/vendedor.entity';

function buildVendedor(overrides: Partial<Vendedor> = {}): Vendedor {
  return {
    id: 'vendedor-1',
    tenantId: 'tenant-1',
    name: 'João Silva',
    email: 'joao@example.com',
    aliquotaComissaoPct: 5,
    descontoMaximoPct: 10,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('VendedorService', () => {
  function buildService() {
    const vendedores: jest.Mocked<VendedorRepository> = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(null),
      findAllByTenant: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      setActive: jest.fn(),
    };
    const service = new VendedorService(vendedores);
    return { service, vendedores };
  }

  describe('create', () => {
    it('rejeita nome vazio', async () => {
      const { service } = buildService();
      await expect(service.create('tenant-1', { name: '', aliquotaComissaoPct: 5 })).rejects.toThrow(BadRequestException);
    });

    it('rejeita aliquotaComissaoPct fora de 0-100', async () => {
      const { service } = buildService();
      await expect(service.create('tenant-1', { name: 'João', aliquotaComissaoPct: 150 })).rejects.toThrow(BadRequestException);
    });

    it('cria o vendedor com os dados normalizados', async () => {
      const { service, vendedores } = buildService();
      const vendedor = buildVendedor();
      vendedores.create.mockResolvedValue(vendedor);

      const result = await service.create('tenant-1', { name: 'João Silva', aliquotaComissaoPct: 5 });

      expect(vendedores.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', name: 'João Silva', aliquotaComissaoPct: 5, email: null, descontoMaximoPct: null }),
      );
      expect(result).toEqual(vendedor);
    });
  });

  describe('findOne', () => {
    it('rejeita vendedor não encontrado', async () => {
      const { service } = buildService();
      await expect(service.findOne('tenant-1', 'vendedor-1')).rejects.toThrow(NotFoundException);
    });

    it('devolve o vendedor encontrado', async () => {
      const { service, vendedores } = buildService();
      const vendedor = buildVendedor();
      vendedores.findById.mockResolvedValue(vendedor);

      const result = await service.findOne('tenant-1', 'vendedor-1');

      expect(result).toEqual(vendedor);
    });
  });

  describe('update', () => {
    it('rejeita vendedor não encontrado', async () => {
      const { service } = buildService();
      await expect(service.update('tenant-1', 'vendedor-1', { name: 'Novo Nome' })).rejects.toThrow(NotFoundException);
    });

    it('rejeita alíquota inválida combinada com o dado atual', async () => {
      const { service, vendedores } = buildService();
      vendedores.findById.mockResolvedValue(buildVendedor());
      await expect(service.update('tenant-1', 'vendedor-1', { aliquotaComissaoPct: -5 })).rejects.toThrow(BadRequestException);
    });

    it('atualiza os campos informados', async () => {
      const { service, vendedores } = buildService();
      const vendedor = buildVendedor();
      vendedores.findById.mockResolvedValue(vendedor);
      vendedores.update.mockResolvedValue({ ...vendedor, name: 'Novo Nome' });

      const result = await service.update('tenant-1', 'vendedor-1', { name: 'Novo Nome' });

      expect(vendedores.update).toHaveBeenCalledWith('vendedor-1', { name: 'Novo Nome' });
      expect(result.name).toBe('Novo Nome');
    });
  });

  describe('setActive', () => {
    it('rejeita vendedor não encontrado', async () => {
      const { service } = buildService();
      await expect(service.setActive('tenant-1', 'vendedor-1', false)).rejects.toThrow(NotFoundException);
    });

    it('ativa/inativa o vendedor', async () => {
      const { service, vendedores } = buildService();
      const vendedor = buildVendedor();
      vendedores.findById.mockResolvedValue(vendedor);
      vendedores.setActive.mockResolvedValue({ ...vendedor, isActive: false });

      const result = await service.setActive('tenant-1', 'vendedor-1', false);

      expect(vendedores.setActive).toHaveBeenCalledWith('vendedor-1', false);
      expect(result.isActive).toBe(false);
    });
  });

  describe('findById (SellerReader)', () => {
    it('devolve null quando o vendedor não existe', async () => {
      const { service } = buildService();
      const result = await service.findById('tenant-1', 'vendedor-1');
      expect(result).toBeNull();
    });

    it('devolve o DTO autocontido (SellerSummary), nunca o Vendedor completo', async () => {
      const { service, vendedores } = buildService();
      vendedores.findById.mockResolvedValue(buildVendedor({ name: 'Maria', aliquotaComissaoPct: 8, isActive: true }));

      const result = await service.findById('tenant-1', 'vendedor-1');

      expect(result).toEqual({ id: 'vendedor-1', name: 'Maria', aliquotaComissaoPct: 8, isActive: true });
    });
  });
});
