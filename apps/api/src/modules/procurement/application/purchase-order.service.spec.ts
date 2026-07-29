import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderRepository } from './ports/purchase-order-repository.port';
import { SupplierRepository } from '../../catalog/application/ports/supplier-repository.port';
import { WarehouseRepository } from '../../logistics-fulfillment/application/ports/warehouse-repository.port';
import { StockReceiptWriter } from '../../../shared/contracts/stock-receipt-writer.port';
import { AccountsPayableWriter } from '../../../shared/contracts/accounts-payable-writer.port';
import { PurchaseOrder } from '../domain/purchase-order.entity';

function buildOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po-1',
    tenantId: 'tenant-1',
    status: 'ABERTO',
    supplierId: 'supplier-1',
    warehouseId: 'warehouse-1',
    paymentDueDate: new Date('2026-08-15'),
    notes: null,
    invoiceNumber: null,
    receivedAt: null,
    createdAt: new Date('2026-07-28'),
    updatedAt: new Date('2026-07-28'),
    items: [
      {
        id: 'item-1',
        tenantId: 'tenant-1',
        purchaseOrderId: 'po-1',
        skuCode: 'SKU-1',
        quantity: 10,
        unitCost: 5,
        ipi: null,
        createdAt: new Date('2026-07-28'),
        updatedAt: new Date('2026-07-28'),
      },
    ],
    ...overrides,
  };
}

describe('PurchaseOrderService', () => {
  let service: PurchaseOrderService;
  let orders: jest.Mocked<PurchaseOrderRepository>;
  let suppliers: jest.Mocked<SupplierRepository>;
  let warehouses: jest.Mocked<WarehouseRepository>;
  let stockReceiptWriter: jest.Mocked<StockReceiptWriter>;
  let accountsPayableWriter: jest.Mocked<AccountsPayableWriter>;

  beforeEach(() => {
    orders = {
      create: jest.fn(),
      findById: jest.fn(),
      findAllByTenant: jest.fn(),
      updateStatus: jest.fn(),
      markReceived: jest.fn(),
    };
    suppliers = {
      create: jest.fn(),
      findAllActive: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };
    warehouses = {
      findById: jest.fn(),
      findByCode: jest.fn(),
      findAllByTenant: jest.fn(),
      upsert: jest.fn(),
      updateLeadTimeDays: jest.fn(),
      updateLogisticsCostPerUnit: jest.fn(),
    };
    stockReceiptWriter = { receivePurchase: jest.fn() };
    accountsPayableWriter = { createSingle: jest.fn() };

    service = new PurchaseOrderService(orders, suppliers, warehouses, stockReceiptWriter, accountsPayableWriter);
  });

  describe('create', () => {
    const validInput = {
      supplierId: 'supplier-1',
      warehouseId: 'warehouse-1',
      paymentDueDate: new Date('2026-08-15'),
      items: [{ skuCode: 'SKU-1', quantity: 10, unitCost: 5 }],
    };

    it('rejeita quando items é inválido', async () => {
      await expect(service.create('tenant-1', { ...validInput, items: [] })).rejects.toThrow(BadRequestException);
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('rejeita quando fornecedor não pertence ao tenant', async () => {
      suppliers.findById.mockResolvedValue(null);
      await expect(service.create('tenant-1', validInput)).rejects.toThrow(BadRequestException);
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('rejeita quando depósito não pertence ao tenant', async () => {
      suppliers.findById.mockResolvedValue({ id: 'supplier-1' } as never);
      warehouses.findById.mockResolvedValue({ id: 'warehouse-1', tenantId: 'outro-tenant' } as never);
      await expect(service.create('tenant-1', validInput)).rejects.toThrow(BadRequestException);
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('cria a ordem quando fornecedor e depósito são válidos', async () => {
      suppliers.findById.mockResolvedValue({ id: 'supplier-1' } as never);
      warehouses.findById.mockResolvedValue({ id: 'warehouse-1', tenantId: 'tenant-1' } as never);
      orders.create.mockResolvedValue(buildOrder());

      const result = await service.create('tenant-1', validInput);

      expect(result.id).toBe('po-1');
      expect(orders.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', supplierId: 'supplier-1', warehouseId: 'warehouse-1' }),
      );
    });
  });

  describe('advance', () => {
    it('avança ABERTO -> ANDAMENTO', async () => {
      orders.findById.mockResolvedValue(buildOrder({ status: 'ABERTO' }));
      orders.updateStatus.mockResolvedValue(buildOrder({ status: 'ANDAMENTO' }));

      const result = await service.advance('tenant-1', 'po-1');

      expect(orders.updateStatus).toHaveBeenCalledWith('po-1', 'ANDAMENTO');
      expect(result.status).toBe('ANDAMENTO');
    });

    it('rejeita avançar a partir de ATENDIDO', async () => {
      orders.findById.mockResolvedValue(buildOrder({ status: 'ATENDIDO' }));
      await expect(service.advance('tenant-1', 'po-1')).rejects.toThrow(BadRequestException);
      expect(orders.updateStatus).not.toHaveBeenCalled();
    });

    it('lança NotFoundException quando a ordem não existe', async () => {
      orders.findById.mockResolvedValue(null);
      await expect(service.advance('tenant-1', 'po-inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancel', () => {
    it('cancela a partir de ABERTO', async () => {
      orders.findById.mockResolvedValue(buildOrder({ status: 'ABERTO' }));
      orders.updateStatus.mockResolvedValue(buildOrder({ status: 'CANCELADO' }));

      const result = await service.cancel('tenant-1', 'po-1');

      expect(orders.updateStatus).toHaveBeenCalledWith('po-1', 'CANCELADO');
      expect(result.status).toBe('CANCELADO');
    });

    it('é idempotente quando já está CANCELADO — não chama o repositório', async () => {
      orders.findById.mockResolvedValue(buildOrder({ status: 'CANCELADO' }));

      const result = await service.cancel('tenant-1', 'po-1');

      expect(orders.updateStatus).not.toHaveBeenCalled();
      expect(result.status).toBe('CANCELADO');
    });

    it('rejeita cancelar a partir de ATENDIDO', async () => {
      orders.findById.mockResolvedValue(buildOrder({ status: 'ATENDIDO' }));
      await expect(service.cancel('tenant-1', 'po-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('receive', () => {
    it('rejeita sem número de nota fiscal', async () => {
      await expect(service.receive('tenant-1', 'po-1', '', 'user-1')).rejects.toThrow(BadRequestException);
      expect(orders.findById).not.toHaveBeenCalled();
    });

    it('rejeita receber a partir de ATENDIDO', async () => {
      orders.findById.mockResolvedValue(buildOrder({ status: 'ATENDIDO' }));
      await expect(service.receive('tenant-1', 'po-1', 'NF-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(stockReceiptWriter.receivePurchase).not.toHaveBeenCalled();
      expect(accountsPayableWriter.createSingle).not.toHaveBeenCalled();
    });

    it('credita estoque, lança a conta a pagar e marca ATENDIDO — nessa ordem', async () => {
      const order = buildOrder({ status: 'ABERTO' });
      orders.findById.mockResolvedValue(order);
      stockReceiptWriter.receivePurchase.mockResolvedValue({ auditEventId: 'audit-1' });
      accountsPayableWriter.createSingle.mockResolvedValue({ id: 'ap-1', amount: 50 });
      orders.markReceived.mockResolvedValue(buildOrder({ status: 'ATENDIDO', invoiceNumber: 'NF-1' }));

      const callOrder: string[] = [];
      stockReceiptWriter.receivePurchase.mockImplementation(async () => {
        callOrder.push('receivePurchase');
        return { auditEventId: 'audit-1' };
      });
      accountsPayableWriter.createSingle.mockImplementation(async () => {
        callOrder.push('createSingle');
        return { id: 'ap-1', amount: 50 };
      });
      orders.markReceived.mockImplementation(async () => {
        callOrder.push('markReceived');
        return buildOrder({ status: 'ATENDIDO', invoiceNumber: 'NF-1' });
      });

      const result = await service.receive('tenant-1', 'po-1', 'NF-1', 'user-1');

      expect(callOrder).toEqual(['receivePurchase', 'createSingle', 'markReceived']);
      expect(stockReceiptWriter.receivePurchase).toHaveBeenCalledWith(
        'tenant-1',
        'warehouse-1',
        'NF-1',
        'user-1',
        [{ skuCode: 'SKU-1', quantity: 10 }],
      );
      expect(accountsPayableWriter.createSingle).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ amount: 50, supplierId: 'supplier-1', dueDate: order.paymentDueDate }),
      );
      expect(orders.markReceived).toHaveBeenCalledWith(
        'po-1',
        expect.objectContaining({ status: 'ATENDIDO', invoiceNumber: 'NF-1' }),
      );
      expect(result.status).toBe('ATENDIDO');
    });

    it('não lança conta a pagar se o crédito de estoque falhar', async () => {
      orders.findById.mockResolvedValue(buildOrder({ status: 'ABERTO' }));
      stockReceiptWriter.receivePurchase.mockRejectedValue(new Error('falha ao creditar estoque'));

      await expect(service.receive('tenant-1', 'po-1', 'NF-1', 'user-1')).rejects.toThrow('falha ao creditar estoque');
      expect(accountsPayableWriter.createSingle).not.toHaveBeenCalled();
      expect(orders.markReceived).not.toHaveBeenCalled();
    });
  });
});
