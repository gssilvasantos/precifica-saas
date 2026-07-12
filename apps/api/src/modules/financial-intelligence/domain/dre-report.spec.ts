import { buildDreReport } from './dre-report';
import { OrderFinancialLine, OrderFinancialLineItem } from '../../../shared/contracts/order-financials-reader.port';

function buildItem(overrides: Partial<OrderFinancialLineItem> = {}): OrderFinancialLineItem {
  return {
    skuCode: 'SKU-1',
    quantity: 1,
    totalPrice: 100,
    taxAmount: null,
    costPriceUsed: 40,
    costKnown: true,
    ...overrides,
  };
}

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
    items: [buildItem()],
    ...overrides,
  };
}

describe('buildDreReport', () => {
  it('calcula receitaBruta, deducoes, custosVariaveis e margemContribuicao para um único canal completo', () => {
    const line = buildLine({
      totalAmount: 100,
      shippingAmount: 10,
      discountAmount: 5,
      feeAmount: 0, // NUVEMSHOP — comissão zero confirmada
      items: [buildItem({ costPriceUsed: 30, quantity: 2, totalPrice: 100, taxAmount: 3 })],
    });

    const report = buildDreReport('tenant-1', [line], null, null, new Date('2026-07-10'));

    // deducoes = taxAmount(3) + discountAmount(5) = 8
    // custosVariaveis = cmv(30*2=60) + fretes(10) + comissao(0) = 70
    // margem = 100 - 8 - 70 = 22
    expect(report.receitaBruta).toBe(100);
    expect(report.deducoes).toBe(8);
    expect(report.custosVariaveis).toBe(70);
    expect(report.margemContribuicao).toBe(22);
    expect(report.margemContribuicaoPct).toBeCloseTo(22);
    expect(report.dataQuality).toBe('COMPLETE');
    expect(report.incompleteOrders).toHaveLength(0);
  });

  it('agrupa por canal e ordena por margemContribuicao desc (pronto para o gráfico de barras)', () => {
    const lowMargin = buildLine({ orderId: 'o1', channelCode: 'NUVEMSHOP', totalAmount: 100, items: [buildItem({ costPriceUsed: 90, totalPrice: 100 })] }); // margem 10
    const highMargin = buildLine({ orderId: 'o2', channelCode: 'SHOPEE', totalAmount: 100, feeAmount: 15, items: [buildItem({ costPriceUsed: 10, totalPrice: 100 })] }); // margem 75

    const report = buildDreReport('tenant-1', [lowMargin, highMargin], null, null);

    expect(report.channels.map((c) => c.channelCode)).toEqual(['SHOPEE', 'NUVEMSHOP']);
    expect(report.channels[0].margemContribuicao).toBeGreaterThan(report.channels[1].margemContribuicao);
  });

  it('exclui pedidos CANCELADO do cálculo (não são receita reconhecida)', () => {
    const active = buildLine({ orderId: 'o1', status: 'ENTREGUE', totalAmount: 100 });
    const cancelled = buildLine({ orderId: 'o2', status: 'CANCELADO', totalAmount: 500 });

    const report = buildDreReport('tenant-1', [active, cancelled], null, null);

    expect(report.receitaBruta).toBe(100);
    expect(report.channels[0].orderCount).toBe(1);
  });

  describe('Regra de Ouro — integridade de dados', () => {
    it('item com custo desconhecido: contribui 0 ao CMV, sinaliza o pedido em incompleteOrders, mas NÃO corrompe o total do período', () => {
      const complete = buildLine({ orderId: 'o1', totalAmount: 100, items: [buildItem({ costPriceUsed: 40, totalPrice: 100 })] });
      const incomplete = buildLine({
        orderId: 'o2',
        externalOrderId: 'EXT-2',
        totalAmount: 200,
        items: [buildItem({ skuCode: 'SKU-X', costPriceUsed: null, costKnown: false, totalPrice: 200 })],
      });

      const report = buildDreReport('tenant-1', [complete, incomplete], null, null);

      // O total ainda soma os DOIS pedidos — nunca some o pedido incompleto do relatório.
      expect(report.receitaBruta).toBe(300);
      expect(report.dataQuality).toBe('INCOMPLETE');
      expect(report.incompleteOrders).toHaveLength(1);
      expect(report.incompleteOrders[0]).toMatchObject({ orderId: 'o2', externalOrderId: 'EXT-2', channelCode: 'NUVEMSHOP' });
      expect(report.incompleteOrders[0].reasons[0]).toContain('SKU-X');
    });

    it('canal com pelo menos um pedido incompleto fica marcado INCOMPLETE no breakdown do canal', () => {
      const line = buildLine({ items: [buildItem({ costKnown: false, costPriceUsed: null })] });

      const report = buildDreReport('tenant-1', [line], null, null);

      expect(report.channels[0].dataQuality).toBe('INCOMPLETE');
    });

    it('feeAmount = 0 em canal SEM confirmação de comissão zero (não-Nuvemshop): sinaliza como incompleto', () => {
      const line = buildLine({ channelCode: 'SHOPEE', feeAmount: 0 });

      const report = buildDreReport('tenant-1', [line], null, null);

      expect(report.dataQuality).toBe('INCOMPLETE');
      expect(report.incompleteOrders[0].reasons.some((r) => r.includes('Comissão'))).toBe(true);
    });

    it('feeAmount = 0 na NUVEMSHOP não é sinalizado (comissão zero é o valor correto e confirmado)', () => {
      const line = buildLine({ channelCode: 'NUVEMSHOP', feeAmount: 0 });

      const report = buildDreReport('tenant-1', [line], null, null);

      expect(report.dataQuality).toBe('COMPLETE');
      expect(report.incompleteOrders).toHaveLength(0);
    });
  });

  it('período sem nenhum pedido: totais zerados, sem divisão por zero (margemContribuicaoPct null)', () => {
    const report = buildDreReport('tenant-1', [], new Date('2026-07-01'), new Date('2026-07-31'));

    expect(report.receitaBruta).toBe(0);
    expect(report.margemContribuicao).toBe(0);
    expect(report.margemContribuicaoPct).toBeNull();
    expect(report.channels).toHaveLength(0);
    expect(report.dataQuality).toBe('COMPLETE');
  });

  it('preserva o período informado no relatório', () => {
    const from = new Date('2026-07-01');
    const to = new Date('2026-07-31');

    const report = buildDreReport('tenant-1', [], from, to);

    expect(report.periodFrom).toBe(from);
    expect(report.periodTo).toBe(to);
    expect(report.tenantId).toBe('tenant-1');
  });

  describe('orderLines (Sprint 23 — DRE por pedido)', () => {
    it('gera uma linha por pedido reconhecido, com a mesma fórmula de waterfall do canal', () => {
      const line = buildLine({
        orderId: 'order-42',
        externalOrderId: 'EXT-42',
        totalAmount: 100,
        shippingAmount: 10,
        discountAmount: 5,
        feeAmount: 8,
        items: [buildItem({ costPriceUsed: 30, quantity: 2, totalPrice: 100, taxAmount: 3 })],
      });

      const report = buildDreReport('tenant-1', [line], null, null);

      // deducoes = taxAmount(3) + discountAmount(5) = 8
      // custosVariaveis = cmv(30*2=60) + fretes(10) + comissao(8) = 78
      // margemLiquida = 100 - 8 - 78 = 14
      expect(report.orderLines).toHaveLength(1);
      expect(report.orderLines[0]).toMatchObject({
        orderId: 'order-42',
        externalOrderId: 'EXT-42',
        channelCode: 'NUVEMSHOP',
        totalAmount: 100,
        feeAmount: 8,
        cmv: 60,
        margemLiquida: 14,
        dataQuality: 'COMPLETE',
      });
    });

    it('exclui pedidos CANCELADO das orderLines, igual ao resto do relatório', () => {
      const active = buildLine({ orderId: 'o1', status: 'ENTREGUE' });
      const cancelled = buildLine({ orderId: 'o2', status: 'CANCELADO' });

      const report = buildDreReport('tenant-1', [active, cancelled], null, null);

      expect(report.orderLines).toHaveLength(1);
      expect(report.orderLines[0].orderId).toBe('o1');
    });

    it('ordena orderLines por orderedAt desc (pedido mais recente primeiro)', () => {
      const older = buildLine({ orderId: 'o-old', orderedAt: new Date('2026-07-01') });
      const newer = buildLine({ orderId: 'o-new', orderedAt: new Date('2026-07-05') });

      const report = buildDreReport('tenant-1', [older, newer], null, null);

      expect(report.orderLines.map((o) => o.orderId)).toEqual(['o-new', 'o-old']);
    });

    it('pedido com item de custo desconhecido: orderLine fica INCOMPLETE (mesmo critério de incompleteOrders)', () => {
      const line = buildLine({ items: [buildItem({ costKnown: false, costPriceUsed: null })] });

      const report = buildDreReport('tenant-1', [line], null, null);

      expect(report.orderLines[0].dataQuality).toBe('INCOMPLETE');
    });
  });
});
