import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountsPayableService } from './accounts-payable.service';
import { AccountsPayableRepository } from './ports/accounts-payable-repository.port';
import { SupplierRepository } from '../../catalog/application/ports/supplier-repository.port';
import { AccountsPayable } from '../domain/accounts-payable.entity';
import { Supplier } from '../../catalog/domain/supplier.entity';
import { ACCOUNTS_PAYABLE_EVENTS } from '../domain/accounts-payable-events';

function buildPayable(overrides: Partial<AccountsPayable> = {}): AccountsPayable {
  return {
    id: 'ap-1',
    tenantId: 'tenant-1',
    amount: 150,
    status: 'PENDING',
    description: 'Aluguel do galpão',
    category: null,
    supplierId: null,
    dueDate: new Date('2026-08-15'),
    paidAt: null,
    paidAmount: null,
    interestAmount: null,
    discountAmount: null,
    feeAmount: null,
    occurrence: 'UNICA',
    installmentGroupId: null,
    installmentNumber: null,
    totalInstallments: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup-1',
    tenantId: 'tenant-1',
    name: 'Fornecedor X',
    contact: null,
    leadTimeDays: null,
    paymentTerms: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AccountsPayableService', () => {
  function buildService() {
    const payables: jest.Mocked<AccountsPayableRepository> = {
      create: jest.fn(),
      createMany: jest.fn(),
      findById: jest.fn(),
      findAllByTenant: jest.fn(),
      update: jest.fn(),
      markPaid: jest.fn(),
      cancel: jest.fn(),
    };
    const suppliers: jest.Mocked<SupplierRepository> = {
      create: jest.fn(),
      findAllActive: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };
    const events = { emit: jest.fn() } as unknown as jest.Mocked<EventEmitter2>;
    const service = new AccountsPayableService(payables, suppliers, events);
    return { service, payables, suppliers, events };
  }

  describe('create', () => {
    it('cria uma única conta quando occurrence não é PARCELADA', async () => {
      const { service, payables } = buildService();
      payables.create.mockResolvedValue(buildPayable());

      const result = await service.create('tenant-1', {
        amount: 150,
        description: 'Aluguel do galpão',
        dueDate: new Date('2026-08-15'),
        occurrence: 'UNICA',
      });

      expect(result).toHaveLength(1);
      expect(payables.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', amount: 150, occurrence: 'UNICA', installmentGroupId: null }),
      );
      expect(payables.createMany).not.toHaveBeenCalled();
    });

    it('rejeita description vazia', async () => {
      const { service, payables } = buildService();
      await expect(
        service.create('tenant-1', { amount: 150, description: '', dueDate: new Date(), occurrence: 'UNICA' }),
      ).rejects.toThrow();
      expect(payables.create).not.toHaveBeenCalled();
    });

    it('rejeita amount não positivo', async () => {
      const { service, payables } = buildService();
      await expect(
        service.create('tenant-1', { amount: 0, description: 'x', dueDate: new Date(), occurrence: 'UNICA' }),
      ).rejects.toThrow();
      expect(payables.create).not.toHaveBeenCalled();
    });

    it('rejeita occurrence inválida', async () => {
      const { service, payables } = buildService();
      await expect(
        service.create('tenant-1', { amount: 150, description: 'x', dueDate: new Date(), occurrence: 'QUINZENAL' }),
      ).rejects.toThrow();
      expect(payables.create).not.toHaveBeenCalled();
    });

    it('rejeita fornecedor de outro tenant', async () => {
      const { service, payables, suppliers } = buildService();
      suppliers.findById.mockResolvedValue(null);

      await expect(
        service.create('tenant-1', {
          amount: 150,
          description: 'x',
          dueDate: new Date(),
          occurrence: 'UNICA',
          supplierId: 'sup-1',
        }),
      ).rejects.toThrow();
      expect(payables.create).not.toHaveBeenCalled();
    });

    it('PARCELADA sem totalInstallments (ou < 2) é rejeitada', async () => {
      const { service, payables } = buildService();
      await expect(
        service.create('tenant-1', { amount: 300, description: 'x', dueDate: new Date(), occurrence: 'PARCELADA' }),
      ).rejects.toThrow();
      await expect(
        service.create('tenant-1', {
          amount: 300,
          description: 'x',
          dueDate: new Date(),
          occurrence: 'PARCELADA',
          totalInstallments: 1,
        }),
      ).rejects.toThrow();
      expect(payables.createMany).not.toHaveBeenCalled();
    });

    it('PARCELADA gera N registros com a mesma installmentGroupId via createMany', async () => {
      const { service, payables } = buildService();
      payables.createMany.mockImplementation(async (records) =>
        records.map((r, i) => buildPayable({ id: `ap-${i}`, ...r, amount: Number(r.amount) })),
      );

      const result = await service.create('tenant-1', {
        amount: 300,
        description: 'Compra parcelada',
        dueDate: new Date('2026-08-01'),
        occurrence: 'PARCELADA',
        totalInstallments: 3,
      });

      expect(result).toHaveLength(3);
      expect(payables.createMany).toHaveBeenCalledTimes(1);
      const recordsSent = payables.createMany.mock.calls[0][0];
      const groupIds = new Set(recordsSent.map((r) => r.installmentGroupId));
      expect(groupIds.size).toBe(1);
      expect(recordsSent.map((r) => r.installmentNumber)).toEqual([1, 2, 3]);
    });
  });

  describe('markPaid', () => {
    it('marca como paga e emite evento (sem ajustes: baixa pelo valor de face)', async () => {
      const { service, payables, events } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PENDING', amount: 150 }));
      payables.markPaid.mockResolvedValue(
        buildPayable({ status: 'PAID', paidAt: new Date('2026-07-28'), paidAmount: 150 }),
      );

      const result = await service.markPaid('tenant-1', 'ap-1', new Date('2026-07-28'));

      expect(result.status).toBe('PAID');
      expect(payables.markPaid).toHaveBeenCalledWith('ap-1', new Date('2026-07-28'), {
        paidAmount: 150,
        interestAmount: null,
        discountAmount: null,
        feeAmount: null,
      });
      expect(events.emit).toHaveBeenCalledWith(
        ACCOUNTS_PAYABLE_EVENTS.PAID,
        expect.objectContaining({ tenantId: 'tenant-1', accountsPayableId: 'ap-1', paidAmount: 150 }),
      );
    });

    it('Quick Win 4: baixa com juros soma ao valor de face', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PENDING', amount: 150 }));
      payables.markPaid.mockResolvedValue(buildPayable({ status: 'PAID', paidAmount: 160 }));

      await service.markPaid('tenant-1', 'ap-1', new Date('2026-07-28'), { interestAmount: 10 });

      expect(payables.markPaid).toHaveBeenCalledWith('ap-1', new Date('2026-07-28'), {
        paidAmount: 160,
        interestAmount: 10,
        discountAmount: null,
        feeAmount: null,
      });
    });

    it('Quick Win 4: baixa com desconto subtrai do valor de face', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PENDING', amount: 150 }));
      payables.markPaid.mockResolvedValue(buildPayable({ status: 'PAID', paidAmount: 130 }));

      await service.markPaid('tenant-1', 'ap-1', new Date('2026-07-28'), { discountAmount: 20 });

      expect(payables.markPaid).toHaveBeenCalledWith('ap-1', new Date('2026-07-28'), {
        paidAmount: 130,
        interestAmount: null,
        discountAmount: 20,
        feeAmount: null,
      });
    });

    it('Quick Win 4: baixa com tarifa soma ao valor de face', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PENDING', amount: 150 }));
      payables.markPaid.mockResolvedValue(buildPayable({ status: 'PAID', paidAmount: 155 }));

      await service.markPaid('tenant-1', 'ap-1', new Date('2026-07-28'), { feeAmount: 5 });

      expect(payables.markPaid).toHaveBeenCalledWith('ap-1', new Date('2026-07-28'), {
        paidAmount: 155,
        interestAmount: null,
        discountAmount: null,
        feeAmount: 5,
      });
    });

    it('Quick Win 4: juros + desconto + tarifa combinados', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PENDING', amount: 150 }));
      payables.markPaid.mockResolvedValue(buildPayable({ status: 'PAID', paidAmount: 145 }));

      // 150 + 10 (juros) - 20 (desconto) + 5 (tarifa) = 145
      await service.markPaid('tenant-1', 'ap-1', new Date('2026-07-28'), {
        interestAmount: 10,
        discountAmount: 20,
        feeAmount: 5,
      });

      expect(payables.markPaid).toHaveBeenCalledWith('ap-1', new Date('2026-07-28'), {
        paidAmount: 145,
        interestAmount: 10,
        discountAmount: 20,
        feeAmount: 5,
      });
    });

    it('rejeita ajuste negativo', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PENDING', amount: 150 }));

      await expect(
        service.markPaid('tenant-1', 'ap-1', new Date('2026-07-28'), { discountAmount: -10 }),
      ).rejects.toThrow();
      expect(payables.markPaid).not.toHaveBeenCalled();
    });

    it('rejeita quando os ajustes resultam em valor baixado <= 0', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PENDING', amount: 150 }));

      await expect(
        service.markPaid('tenant-1', 'ap-1', new Date('2026-07-28'), { discountAmount: 150 }),
      ).rejects.toThrow();
      expect(payables.markPaid).not.toHaveBeenCalled();
    });

    it('é idempotente: já paga não chama o repositório de novo nem reemite evento', async () => {
      const { service, payables, events } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PAID' }));

      const result = await service.markPaid('tenant-1', 'ap-1');

      expect(result.status).toBe('PAID');
      expect(payables.markPaid).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('rejeita marcar como paga uma conta cancelada', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'CANCELLED' }));

      await expect(service.markPaid('tenant-1', 'ap-1')).rejects.toThrow();
      expect(payables.markPaid).not.toHaveBeenCalled();
    });

    it('conta inexistente: lança NotFoundException', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(null);

      await expect(service.markPaid('tenant-1', 'ap-inexistente')).rejects.toThrow();
    });
  });

  describe('cancel', () => {
    it('cancela uma conta pendente', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PENDING' }));
      payables.cancel.mockResolvedValue(buildPayable({ status: 'CANCELLED' }));

      const result = await service.cancel('tenant-1', 'ap-1');

      expect(result.status).toBe('CANCELLED');
      expect(payables.cancel).toHaveBeenCalledWith('ap-1');
    });

    it('rejeita cancelar conta já paga', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PAID' }));

      await expect(service.cancel('tenant-1', 'ap-1')).rejects.toThrow();
      expect(payables.cancel).not.toHaveBeenCalled();
    });

    it('é idempotente: já cancelada não chama o repositório de novo', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'CANCELLED' }));

      const result = await service.cancel('tenant-1', 'ap-1');

      expect(result.status).toBe('CANCELLED');
      expect(payables.cancel).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('atualiza uma conta pendente', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PENDING' }));
      payables.update.mockResolvedValue(buildPayable({ description: 'Novo nome' }));

      const result = await service.update('tenant-1', 'ap-1', { description: 'Novo nome' });

      expect(result.description).toBe('Novo nome');
    });

    it('rejeita editar conta já paga', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(buildPayable({ status: 'PAID' }));

      await expect(service.update('tenant-1', 'ap-1', { description: 'x' })).rejects.toThrow();
      expect(payables.update).not.toHaveBeenCalled();
    });
  });

  describe('list / findOne — effectiveStatus derivado', () => {
    it('deriva OVERDUE para pendente vencida sem persistir nada', async () => {
      const { service, payables } = buildService();
      const overdue = buildPayable({ status: 'PENDING', dueDate: new Date('2020-01-01') });
      payables.findAllByTenant.mockResolvedValue([overdue]);

      const [view] = await service.list('tenant-1');

      expect(view.status).toBe('PENDING');
      expect(view.effectiveStatus).toBe('OVERDUE');
    });

    it('findOne inexistente: lança NotFoundException', async () => {
      const { service, payables } = buildService();
      payables.findById.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'ap-inexistente')).rejects.toThrow();
    });
  });
});
