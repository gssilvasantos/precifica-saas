import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommissionService } from './commission.service';
import { VendedorService } from './vendedor.service';
import { OrderCommissionWriter, CommissionLineDto } from '../../../shared/contracts/order-commission-writer.port';
import { AccountsPayableWriter } from '../../../shared/contracts/accounts-payable-writer.port';
import { Vendedor } from '../domain/vendedor.entity';

function buildVendedor(overrides: Partial<Vendedor> = {}): Vendedor {
  return {
    id: 'vendedor-1',
    tenantId: 'tenant-1',
    name: 'João Silva',
    email: null,
    aliquotaComissaoPct: 5,
    descontoMaximoPct: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildCommissionLine(overrides: Partial<CommissionLineDto> = {}): CommissionLineDto {
  return {
    orderItemId: 'item-1',
    orderId: 'order-1',
    externalOrderId: 'EXT-1',
    skuCode: 'SKU-1',
    productName: 'Produto 1',
    base: 200,
    aliquotaPct: 5,
    valor: 10,
    orderedAt: new Date('2026-07-01'),
    comissaoPagaEm: null,
    ...overrides,
  };
}

describe('CommissionService', () => {
  function buildService() {
    // VendedorService é usado DIRETO (mesmo módulo) — mock manual em vez de
    // jest.Mocked<VendedorRepository> porque aqui testamos CommissionService
    // isoladamente, não a implementação real de VendedorService.
    const vendedores = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<VendedorService>;
    const orderCommissions: jest.Mocked<OrderCommissionWriter> = {
      findItemForCommission: jest.fn(),
      assignVendedorToItem: jest.fn(),
      findCommissionLines: jest.fn().mockResolvedValue([]),
      markCommissionsPaid: jest.fn().mockResolvedValue(0),
    };
    const accountsPayableWriter: jest.Mocked<AccountsPayableWriter> = {
      createSingle: jest.fn(),
    };
    const service = new CommissionService(vendedores, orderCommissions, accountsPayableWriter);
    return { service, vendedores, orderCommissions, accountsPayableWriter };
  }

  describe('assignVendedor', () => {
    it('propaga NotFoundException quando o vendedor não existe (VendedorService.findOne)', async () => {
      const { service, vendedores } = buildService();
      vendedores.findOne.mockRejectedValue(new NotFoundException('Vendedor vendedor-1 não encontrado.'));
      await expect(service.assignVendedor('tenant-1', 'order-1', 'item-1', 'vendedor-1')).rejects.toThrow(NotFoundException);
    });

    it('rejeita vendedor inativo', async () => {
      const { service, vendedores } = buildService();
      vendedores.findOne.mockResolvedValue(buildVendedor({ isActive: false }));
      await expect(service.assignVendedor('tenant-1', 'order-1', 'item-1', 'vendedor-1')).rejects.toThrow(BadRequestException);
    });

    it('rejeita item não encontrado no pedido', async () => {
      const { service, vendedores, orderCommissions } = buildService();
      vendedores.findOne.mockResolvedValue(buildVendedor());
      orderCommissions.findItemForCommission.mockResolvedValue(null);
      await expect(service.assignVendedor('tenant-1', 'order-1', 'item-1', 'vendedor-1')).rejects.toThrow(BadRequestException);
    });

    it('calcula a comissão (snapshot) e persiste no item', async () => {
      const { service, vendedores, orderCommissions } = buildService();
      vendedores.findOne.mockResolvedValue(buildVendedor({ aliquotaComissaoPct: 5 }));
      orderCommissions.findItemForCommission.mockResolvedValue({ id: 'item-1', totalPrice: 200 });
      orderCommissions.assignVendedorToItem.mockResolvedValue({ id: 'item-1', totalPrice: 200 });

      const result = await service.assignVendedor('tenant-1', 'order-1', 'item-1', 'vendedor-1');

      expect(orderCommissions.assignVendedorToItem).toHaveBeenCalledWith('tenant-1', 'order-1', 'item-1', {
        vendedorId: 'vendedor-1',
        comissaoAliquotaPct: 5,
        comissaoValor: 10, // 200 * 5%
      });
      expect(result).toEqual({ id: 'item-1', totalPrice: 200 });
    });
  });

  describe('generatePayout', () => {
    it('rejeita quando não há comissão pendente no período', async () => {
      const { service, vendedores, orderCommissions } = buildService();
      vendedores.findOne.mockResolvedValue(buildVendedor());
      orderCommissions.findCommissionLines.mockResolvedValue([]);

      await expect(
        service.generatePayout('tenant-1', 'vendedor-1', new Date('2026-07-01'), new Date('2026-07-31'), new Date('2026-08-10')),
      ).rejects.toThrow(BadRequestException);
    });

    it('soma as comissões pendentes, gera a conta a pagar e marca os itens como pagos', async () => {
      const { service, vendedores, orderCommissions, accountsPayableWriter } = buildService();
      vendedores.findOne.mockResolvedValue(buildVendedor({ name: 'João Silva' }));
      orderCommissions.findCommissionLines.mockResolvedValue([
        buildCommissionLine({ orderItemId: 'item-1', valor: 10 }),
        buildCommissionLine({ orderItemId: 'item-2', valor: 15 }),
      ]);
      accountsPayableWriter.createSingle.mockResolvedValue({ id: 'payable-1', amount: 25 });

      const result = await service.generatePayout(
        'tenant-1',
        'vendedor-1',
        new Date('2026-07-01'),
        new Date('2026-07-31'),
        new Date('2026-08-10'),
      );

      expect(orderCommissions.findCommissionLines).toHaveBeenCalledWith('tenant-1', 'vendedor-1', {
        dateFrom: new Date('2026-07-01'),
        dateTo: new Date('2026-07-31'),
        onlyPending: true,
      });
      expect(accountsPayableWriter.createSingle).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ amount: 25, dueDate: new Date('2026-08-10') }),
      );
      expect(orderCommissions.markCommissionsPaid).toHaveBeenCalledWith('tenant-1', ['item-1', 'item-2'], expect.any(Date));
      expect(result).toEqual({ accountsPayableId: 'payable-1', amount: 25, itemCount: 2 });
    });
  });

  describe('listCommissions', () => {
    it('valida a existência do vendedor antes de buscar as linhas', async () => {
      const { service, vendedores, orderCommissions } = buildService();
      vendedores.findOne.mockResolvedValue(buildVendedor());
      orderCommissions.findCommissionLines.mockResolvedValue([buildCommissionLine()]);

      const result = await service.listCommissions('tenant-1', 'vendedor-1');

      expect(vendedores.findOne).toHaveBeenCalledWith('tenant-1', 'vendedor-1');
      expect(result).toHaveLength(1);
    });
  });
});
