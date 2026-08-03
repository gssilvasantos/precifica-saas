import { WarehouseService } from './warehouse.service';
import { WarehouseRepository } from './ports/warehouse-repository.port';
import { StockLedgerRepository } from './ports/stock-ledger-repository.port';
import { StockMovementAuditEventRepository } from './ports/stock-movement-audit-event-repository.port';
import { Warehouse } from '../domain/warehouse.entity';

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

describe('WarehouseService', () => {
  function buildService() {
    const warehouses: jest.Mocked<WarehouseRepository> = {
      findById: jest.fn(),
      findByCode: jest.fn(),
      findAllByTenant: jest.fn(),
      upsert: jest.fn(),
      updateLeadTimeDays: jest.fn(),
      updateLogisticsCostPerUnit: jest.fn(),
    updateEstimatedFreightCost: jest.fn(),
    };
    const ledger: jest.Mocked<StockLedgerRepository> = {
      getBalance: jest.fn(),
      listBalancesByWarehouse: jest.fn(),
      listBalancesByLot: jest.fn(),
    };
    const auditEvents: jest.Mocked<StockMovementAuditEventRepository> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      attachMedia: jest.fn(),
      approveWithLedger: jest.fn(),
      markDivergent: jest.fn(),
      findPending: jest.fn(),
      listReservedByWarehouse: jest.fn(),
    };
    const service = new WarehouseService(warehouses, ledger, auditEvents);
    return { service, warehouses, ledger, auditEvents };
  }

  it('ensurePhysicalWarehouse: idempotente — não cria de novo se já existe', async () => {
    const { service, warehouses } = buildService();
    warehouses.findByCode.mockResolvedValue(buildWarehouse());

    await service.ensurePhysicalWarehouse('tenant-1');

    expect(warehouses.upsert).not.toHaveBeenCalled();
  });

  it('ensurePhysicalWarehouse: cria com type PHYSICAL e código fixo quando não existe', async () => {
    const { service, warehouses } = buildService();
    warehouses.findByCode.mockResolvedValue(null);
    warehouses.upsert.mockResolvedValue(buildWarehouse());

    await service.ensurePhysicalWarehouse('tenant-1');

    expect(warehouses.upsert).toHaveBeenCalledWith({ tenantId: 'tenant-1', code: 'FISICO', type: 'PHYSICAL' });
  });

  it('ensureFullWarehouse: cria um CD virtual por canal, código previsível', async () => {
    const { service, warehouses } = buildService();
    warehouses.findByCode.mockResolvedValue(null);
    warehouses.upsert.mockResolvedValue(buildWarehouse({ code: 'CD_FULL_MERCADO_LIVRE', type: 'VIRTUAL_FULL', channelCode: 'MERCADO_LIVRE' }));

    await service.ensureFullWarehouse('tenant-1', 'MERCADO_LIVRE');

    expect(warehouses.upsert).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      code: 'CD_FULL_MERCADO_LIVRE',
      type: 'VIRTUAL_FULL',
      channelCode: 'MERCADO_LIVRE',
    });
  });

  describe('updateLeadTimeDays', () => {
    it('atualiza quando o valor é válido e o depósito pertence ao tenant', async () => {
      const { service, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'tenant-1' }));
      warehouses.updateLeadTimeDays.mockResolvedValue(buildWarehouse({ leadTimeDays: 7 }));

      await service.updateLeadTimeDays('tenant-1', 'wh-1', 7);

      expect(warehouses.updateLeadTimeDays).toHaveBeenCalledWith('tenant-1', 'wh-1', 7);
    });

    it('rejeita valor inválido (zero, negativo, fracionado ou acima do teto) sem tocar o repositório', async () => {
      const { service, warehouses } = buildService();
      await expect(service.updateLeadTimeDays('tenant-1', 'wh-1', 0)).rejects.toThrow();
      await expect(service.updateLeadTimeDays('tenant-1', 'wh-1', -3)).rejects.toThrow();
      await expect(service.updateLeadTimeDays('tenant-1', 'wh-1', 3.5)).rejects.toThrow();
      await expect(service.updateLeadTimeDays('tenant-1', 'wh-1', 200)).rejects.toThrow();
      expect(warehouses.updateLeadTimeDays).not.toHaveBeenCalled();
    });

    it('rejeita depósito de outro tenant (nunca edita posse de terceiro)', async () => {
      const { service, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'outro-tenant' }));

      await expect(service.updateLeadTimeDays('tenant-1', 'wh-1', 7)).rejects.toThrow();
      expect(warehouses.updateLeadTimeDays).not.toHaveBeenCalled();
    });

    it('depósito inexistente: lança NotFoundException', async () => {
      const { service, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(null);
      await expect(service.updateLeadTimeDays('tenant-1', 'wh-inexistente', 7)).rejects.toThrow();
    });
  });

  describe('updateLogisticsCostPerUnit', () => {
    it('atualiza quando o valor é válido e o depósito pertence ao tenant', async () => {
      const { service, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'tenant-1' }));
      warehouses.updateLogisticsCostPerUnit.mockResolvedValue(buildWarehouse({ logisticsCostPerUnit: 3.5 }));

      await service.updateLogisticsCostPerUnit('tenant-1', 'wh-1', 3.5);

      expect(warehouses.updateLogisticsCostPerUnit).toHaveBeenCalledWith('tenant-1', 'wh-1', 3.5);
    });

    it('rejeita valor negativo sem tocar o repositório', async () => {
      const { service, warehouses } = buildService();
      await expect(service.updateLogisticsCostPerUnit('tenant-1', 'wh-1', -1)).rejects.toThrow();
      expect(warehouses.updateLogisticsCostPerUnit).not.toHaveBeenCalled();
    });

    it('aceita zero (depósito sem custo operacional cadastrado ainda)', async () => {
      const { service, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'tenant-1' }));
      warehouses.updateLogisticsCostPerUnit.mockResolvedValue(buildWarehouse({ logisticsCostPerUnit: 0 }));

      await service.updateLogisticsCostPerUnit('tenant-1', 'wh-1', 0);

      expect(warehouses.updateLogisticsCostPerUnit).toHaveBeenCalledWith('tenant-1', 'wh-1', 0);
    });

    it('rejeita depósito de outro tenant', async () => {
      const { service, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'outro-tenant' }));

      await expect(service.updateLogisticsCostPerUnit('tenant-1', 'wh-1', 3.5)).rejects.toThrow();
      expect(warehouses.updateLogisticsCostPerUnit).not.toHaveBeenCalled();
    });

    it('depósito inexistente: lança NotFoundException', async () => {
      const { service, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(null);
      await expect(service.updateLogisticsCostPerUnit('tenant-1', 'wh-inexistente', 3.5)).rejects.toThrow();
    });
  });

  describe('listStockBalances (Quick Win 3, benchmark Bling — saldoFisico vs saldoVirtual)', () => {
    it('combina saldo físico com reserva de pedidos pendentes (saldoVirtual = balance - reserved)', async () => {
      const { service, warehouses, ledger, auditEvents } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'tenant-1' }));
      ledger.listBalancesByWarehouse.mockResolvedValue([{ skuCode: 'SKU-1', balance: 10 }]);
      auditEvents.listReservedByWarehouse.mockResolvedValue([{ skuCode: 'SKU-1', reservedQuantity: 3 }]);

      const result = await service.listStockBalances('tenant-1', 'wh-1');

      expect(result).toEqual([{ skuCode: 'SKU-1', balance: 10, reserved: 3, available: 7 }]);
    });

    it('sem nenhuma reserva pendente: available igual ao balance', async () => {
      const { service, warehouses, ledger, auditEvents } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'tenant-1' }));
      ledger.listBalancesByWarehouse.mockResolvedValue([{ skuCode: 'SKU-1', balance: 5 }]);
      auditEvents.listReservedByWarehouse.mockResolvedValue([]);

      const result = await service.listStockBalances('tenant-1', 'wh-1');

      expect(result).toEqual([{ skuCode: 'SKU-1', balance: 5, reserved: 0, available: 5 }]);
    });

    it('depósito de outro tenant: lança NotFoundException sem consultar ledger/reserva', async () => {
      const { service, warehouses, ledger, auditEvents } = buildService();
      warehouses.findById.mockResolvedValue(buildWarehouse({ id: 'wh-1', tenantId: 'outro-tenant' }));

      await expect(service.listStockBalances('tenant-1', 'wh-1')).rejects.toThrow();
      expect(ledger.listBalancesByWarehouse).not.toHaveBeenCalled();
      expect(auditEvents.listReservedByWarehouse).not.toHaveBeenCalled();
    });

    it('depósito inexistente: lança NotFoundException', async () => {
      const { service, warehouses } = buildService();
      warehouses.findById.mockResolvedValue(null);
      await expect(service.listStockBalances('tenant-1', 'wh-inexistente')).rejects.toThrow();
    });
  });
});
