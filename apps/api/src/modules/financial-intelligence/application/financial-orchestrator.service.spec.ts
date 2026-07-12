import { FinancialOrchestrator } from './financial-orchestrator.service';
import { OrderFinancialLine, OrderFinancialsReader } from '../../../shared/contracts/order-financials-reader.port';

function buildLine(overrides: Partial<OrderFinancialLine> = {}): OrderFinancialLine {
  return {
    orderId: 'order-1',
    externalOrderId: 'EXT-1',
    channelCode: 'NUVEMSHOP',
    status: 'ENTREGUE',
    orderedAt: new Date('2026-07-01'),
    totalAmount: 100,
    shippingAmount: 0,
    discountAmount: 0,
    feeAmount: 0,
    items: [{ skuCode: 'SKU-1', quantity: 1, totalPrice: 100, taxAmount: null, costPriceUsed: 40, costKnown: true }],
    ...overrides,
  };
}

describe('FinancialOrchestrator', () => {
  function buildOrchestrator(lines: OrderFinancialLine[]) {
    const orderFinancials: jest.Mocked<OrderFinancialsReader> = {
      listForPeriod: jest.fn().mockResolvedValue(lines),
      findItemsForOrders: jest.fn().mockResolvedValue([]),
    };
    return { orchestrator: new FinancialOrchestrator(orderFinancials), orderFinancials };
  }

  it('busca as linhas do período via ORDER_FINANCIALS_READER e monta o DreReport', async () => {
    const { orchestrator, orderFinancials } = buildOrchestrator([buildLine()]);
    const dateFrom = new Date('2026-07-01');
    const dateTo = new Date('2026-07-31');

    const report = await orchestrator.generateDreReport('tenant-1', dateFrom, dateTo);

    expect(orderFinancials.listForPeriod).toHaveBeenCalledWith('tenant-1', dateFrom, dateTo, undefined);
    expect(report.tenantId).toBe('tenant-1');
    expect(report.periodFrom).toBe(dateFrom);
    expect(report.periodTo).toBe(dateTo);
    expect(report.receitaBruta).toBe(100);
  });

  it('funciona sem período informado (relatório cobre todos os pedidos)', async () => {
    const { orchestrator, orderFinancials } = buildOrchestrator([buildLine()]);

    const report = await orchestrator.generateDreReport('tenant-1');

    expect(orderFinancials.listForPeriod).toHaveBeenCalledWith('tenant-1', undefined, undefined, undefined);
    expect(report.periodFrom).toBeNull();
    expect(report.periodTo).toBeNull();
  });

  it('Audit Mode: repassa o dataMode informado direto ao OrderFinancialsReader (REAL/DEMO nunca se misturam)', async () => {
    const { orchestrator, orderFinancials } = buildOrchestrator([buildLine()]);

    await orchestrator.generateDreReport('tenant-1', undefined, undefined, 'DEMO');

    expect(orderFinancials.listForPeriod).toHaveBeenCalledWith('tenant-1', undefined, undefined, 'DEMO');
  });

  it('agrega corretamente vários canais vindos do reader', async () => {
    const { orchestrator } = buildOrchestrator([
      buildLine({ channelCode: 'NUVEMSHOP', totalAmount: 100 }),
      buildLine({ channelCode: 'SHOPEE', totalAmount: 200, feeAmount: 20 }),
    ]);

    const report = await orchestrator.generateDreReport('tenant-1');

    expect(report.channels).toHaveLength(2);
    expect(report.receitaBruta).toBe(300);
  });
});
