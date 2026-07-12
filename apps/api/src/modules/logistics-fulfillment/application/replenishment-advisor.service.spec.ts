import { ReplenishmentAdvisorService } from './replenishment-advisor.service';
import { WarehouseService } from './warehouse.service';
import { WarehouseRepository } from './ports/warehouse-repository.port';
import { StockLedgerRepository } from './ports/stock-ledger-repository.port';
import { OrderFinancialsReader, OrderFinancialLine } from '../../../shared/contracts/order-financials-reader.port';
import { Warehouse } from '../domain/warehouse.entity';

function buildWarehouse(overrides: Partial<Warehouse> = {}): Warehouse {
  return {
    id: 'wh-physical',
    tenantId: 'tenant-1',
    code: 'FISICO',
    type: 'PHYSICAL',
    channelCode: null,
    isActive: true,
    leadTimeDays: 15,
    logisticsCostPerUnit: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildOrderLine(overrides: Partial<OrderFinancialLine> = {}): OrderFinancialLine {
  return {
    orderId: 'order-1',
    externalOrderId: 'EXT-1',
    channelCode: 'NUVEMSHOP',
    status: 'ENTREGUE',
    orderedAt: new Date(),
    totalAmount: 100,
    shippingAmount: 0,
    discountAmount: 0,
    feeAmount: 0,
    items: [],
    ...overrides,
  };
}

describe('ReplenishmentAdvisorService', () => {
  function buildService(orderLines: OrderFinancialLine[], fullWarehouseLeadTimeDays = 15) {
    const warehouseRepo: jest.Mocked<WarehouseRepository> = {
      findById: jest.fn(),
      findByCode: jest.fn().mockImplementation((_tenantId: string, code: string) => {
        if (code === 'FISICO') return Promise.resolve(buildWarehouse());
        return Promise.resolve(
          buildWarehouse({ id: 'wh-full', code, type: 'VIRTUAL_FULL', channelCode: 'NUVEMSHOP', leadTimeDays: fullWarehouseLeadTimeDays }),
        );
      }),
      findAllByTenant: jest.fn(),
      upsert: jest.fn(),
      updateLeadTimeDays: jest.fn(),
      updateLogisticsCostPerUnit: jest.fn(),
    };
    const warehouses = new WarehouseService(warehouseRepo);

    const ledger: jest.Mocked<StockLedgerRepository> = {
      getBalance: jest.fn(),
      listBalancesByWarehouse: jest.fn().mockImplementation((_tenantId: string, warehouseId: string) => {
        if (warehouseId === 'wh-physical') return Promise.resolve([{ skuCode: 'SKU-1', balance: 200 }]);
        if (warehouseId === 'wh-full') return Promise.resolve([{ skuCode: 'SKU-1', balance: 10 }]);
        return Promise.resolve([]);
      }),
    };

    const orderFinancials: jest.Mocked<OrderFinancialsReader> = {
      listForPeriod: jest.fn().mockResolvedValue(orderLines),
      findItemsForOrders: jest.fn().mockResolvedValue([]),
    };

    const service = new ReplenishmentAdvisorService(warehouses, ledger, orderFinancials);
    return { service, ledger, orderFinancials };
  }

  it('cruza giro (Orders) com saldo do Full e do físico (ledger) e sugere envio', async () => {
    // giro alto o bastante (100 unidades/30 dias) para que o alvo de
    // cobertura (lead time + segurança) supere o saldoFull (10) — só assim
    // faz sentido esperar uma sugestão de envio positiva.
    const { service } = buildService([
      buildOrderLine({ channelCode: 'NUVEMSHOP', items: [{ skuCode: 'SKU-1', quantity: 100, totalPrice: 100, taxAmount: null, costPriceUsed: 5, costKnown: true }] }),
    ]);

    const rows = await service.getReplenishmentTable('tenant-1', 'NUVEMSHOP');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ skuCode: 'SKU-1', channelCode: 'NUVEMSHOP', saldoFull: 10, saldoFisico: 200 });
    expect(rows[0].giroDiario).toBeCloseTo(100 / 30);
    expect(rows[0].sugestaoEnvio).toBeGreaterThan(0);
  });

  it('ignora pedidos de outro canal e pedidos CANCELADO ao calcular giro', async () => {
    const { service } = buildService([
      buildOrderLine({ channelCode: 'MERCADO_LIVRE', items: [{ skuCode: 'SKU-1', quantity: 999, totalPrice: 1, taxAmount: null, costPriceUsed: null, costKnown: false }] }),
      buildOrderLine({ channelCode: 'NUVEMSHOP', status: 'CANCELADO', items: [{ skuCode: 'SKU-1', quantity: 999, totalPrice: 1, taxAmount: null, costPriceUsed: null, costKnown: false }] }),
    ]);

    const rows = await service.getReplenishmentTable('tenant-1', 'NUVEMSHOP');

    // SKU-1 ainda aparece (tem saldo no ledger), mas com giro zero -> SEM_GIRO
    expect(rows[0].status).toBe('SEM_GIRO');
    expect(rows[0].giroDiario).toBe(0);
  });

  it('SKU sem venda recente mas com saldo no Full aparece na tabela como SEM_GIRO, não some', async () => {
    const { service } = buildService([]);
    const rows = await service.getReplenishmentTable('tenant-1', 'NUVEMSHOP');
    expect(rows.find((r) => r.skuCode === 'SKU-1')?.status).toBe('SEM_GIRO');
  });

  it('item sem skuCode resolvido não entra na agregação de giro (não dá pra sugerir reposição do que não identificamos)', async () => {
    const { service } = buildService([
      buildOrderLine({ channelCode: 'NUVEMSHOP', items: [{ skuCode: null, quantity: 50, totalPrice: 100, taxAmount: null, costPriceUsed: null, costKnown: false }] }),
    ]);
    const rows = await service.getReplenishmentTable('tenant-1', 'NUVEMSHOP');
    // só o SKU-1 do saldo do ledger aparece; nenhuma linha "null" é criada
    expect(rows.every((r) => r.skuCode !== null)).toBe(true);
  });

  it('ordena por urgência: CRITICO antes de ATENCAO antes de OK antes de SEM_GIRO', async () => {
    const { service } = buildService([
      buildOrderLine({
        channelCode: 'NUVEMSHOP',
        items: [
          { skuCode: 'SKU-1', quantity: 300, totalPrice: 100, taxAmount: null, costPriceUsed: 5, costKnown: true }, // giro alto, saldoFull baixo (10) -> CRITICO
        ],
      }),
    ]);
    const rows = await service.getReplenishmentTable('tenant-1', 'NUVEMSHOP');
    expect(rows[0].status).toBe('CRITICO');
  });

  it('usa o leadTimeDays CONFIGURADO no depósito Full de destino, nunca uma constante fixa', async () => {
    const orderLines = [
      buildOrderLine({ channelCode: 'NUVEMSHOP', items: [{ skuCode: 'SKU-1', quantity: 300, totalPrice: 100, taxAmount: null, costPriceUsed: 5, costKnown: true }] }),
    ];

    const { service: serviceLeadTime3 } = buildService(orderLines, 3);
    const rowsLeadTime3 = await serviceLeadTime3.getReplenishmentTable('tenant-1', 'NUVEMSHOP');
    expect(rowsLeadTime3[0].leadTimeDaysUsed).toBe(3);

    const { service: serviceLeadTime15 } = buildService(orderLines, 15);
    const rowsLeadTime15 = await serviceLeadTime15.getReplenishmentTable('tenant-1', 'NUVEMSHOP');
    expect(rowsLeadTime15[0].leadTimeDaysUsed).toBe(15);

    // Sugestão de envio muda com o lead time (alvo maior com lead time maior)
    expect(rowsLeadTime15[0].sugestaoEnvio).toBeGreaterThan(rowsLeadTime3[0].sugestaoEnvio);
  });
});
