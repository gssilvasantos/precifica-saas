import { FinancialOrchestrator } from './financial-orchestrator.service';
import { OrderFinancialLine, OrderFinancialsReader } from '../../../shared/contracts/order-financials-reader.port';
import { AdsSpendReader } from '../../../shared/contracts/ads-spend-reader.port';
import { FixedExpense } from '../domain/fixed-expense.entity';

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

function item(skuCode: string, quantity: number) {
  return { skuCode, quantity, totalPrice: 100 * quantity, taxAmount: null, costPriceUsed: 40, costKnown: true };
}

describe('FinancialOrchestrator', () => {
  function buildOrchestrator(
    lines: OrderFinancialLine[],
    adSpend: { channelCode: string; spend: number; hasData: boolean }[] = [],
    fixedExpenses: FixedExpense[] = [],
    adSpendBySku: { skuCode: string; channelCode: string; spend: number; attributedUnits: number }[] = [],
  ) {
    const orderFinancials: jest.Mocked<OrderFinancialsReader> = {
      listForPeriod: jest.fn().mockResolvedValue(lines),
      findItemsForOrders: jest.fn().mockResolvedValue([]),
    };
    const adsSpend: jest.Mocked<AdsSpendReader> = {
      sumSpendByChannel: jest.fn().mockResolvedValue(adSpend),
      sumSpendBySku: jest.fn().mockResolvedValue(adSpendBySku),
    };
    const expenses = {
      create: jest.fn(),
      findAllActive: jest.fn().mockResolvedValue(fixedExpenses),
      findById: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };
    return {
      orchestrator: new FinancialOrchestrator(orderFinancials, adsSpend, expenses),
      orderFinancials,
      adsSpend,
      expenses,
    };
  }

  // Publicidade no DRE (01/08/2026, docs/revisao-geral-2026-08.md §2) — até
  // esta data o relatório ignorava completamente o gasto com Ads.
  describe('custo de Ads', () => {
    it('desconta o gasto com Ads do canal e expõe a margem depois da mídia', async () => {
      const { orchestrator } = buildOrchestrator(
        [buildLine({ channelCode: 'MERCADO_LIVRE', totalAmount: 1000 })],
        [{ channelCode: 'MERCADO_LIVRE', spend: 150, hasData: true }],
      );

      const report = await orchestrator.generateDreReport('tenant-1');
      const ml = report.channels.find((c) => c.channelCode === 'MERCADO_LIVRE');

      expect(ml?.custoAds).toBe(150);
      expect(ml?.margemAposAds).toBeCloseTo((ml?.margemContribuicao ?? 0) - 150, 2);
      expect(report.custoAds).toBe(150);
    });

    it('NÃO altera a margem de contribuição — Ads é custo de período, não de pedido', async () => {
      const semAds = await buildOrchestrator([buildLine({ totalAmount: 1000 })]).orchestrator.generateDreReport('t');
      const comAds = await buildOrchestrator(
        [buildLine({ totalAmount: 1000 })],
        [{ channelCode: 'NUVEMSHOP', spend: 150, hasData: true }],
      ).orchestrator.generateDreReport('t');

      // A métrica que já existia e é usada em gráfico/tela continua com o
      // mesmo significado — a mudança é ADITIVA, não redefine nada.
      expect(comAds.margemContribuicao).toBe(semAds.margemContribuicao);
      expect(comAds.custosVariaveis).toBe(semAds.custosVariaveis);
    });

    it('distingue "não anunciou" de "não temos o dado"', async () => {
      const semDado = await buildOrchestrator([buildLine({ channelCode: 'SHOPEE' })]).orchestrator.generateDreReport('t');
      const gastouZero = await buildOrchestrator(
        [buildLine({ channelCode: 'SHOPEE' })],
        [{ channelCode: 'SHOPEE', spend: 0, hasData: true }],
      ).orchestrator.generateDreReport('t');

      // Os dois mostram custoAds 0, mas só um deles SABE que é zero.
      expect(semDado.channels[0].custoAds).toBe(0);
      expect(semDado.channels[0].adSpendDataAvailable).toBe(false);
      expect(gastouZero.channels[0].custoAds).toBe(0);
      expect(gastouZero.channels[0].adSpendDataAvailable).toBe(true);
    });

    it('ignora gasto de canal sem venda reconhecida no período', async () => {
      // Gasto num canal sem receita não tem contra o que ser comparado, e
      // somá-lo ao total distorceria o consolidado sem aparecer em nenhuma
      // linha por canal.
      const { orchestrator } = buildOrchestrator(
        [buildLine({ channelCode: 'NUVEMSHOP' })],
        [{ channelCode: 'AMAZON', spend: 500, hasData: true }],
      );

      const report = await orchestrator.generateDreReport('tenant-1');

      expect(report.custoAds).toBe(0);
      expect(report.channels.some((c) => c.channelCode === 'AMAZON')).toBe(false);
    });

    it('repassa o período e o dataMode para o leitor de Ads', async () => {
      const { orchestrator, adsSpend } = buildOrchestrator([buildLine()]);
      const dateFrom = new Date('2026-07-01');
      const dateTo = new Date('2026-07-31');

      await orchestrator.generateDreReport('tenant-1', dateFrom, dateTo, 'DEMO');

      expect(adsSpend.sumSpendByChannel).toHaveBeenCalledWith('tenant-1', dateFrom, dateTo, 'DEMO');
    });
  });

  // Custo de Ads por PEDIDO (01/08/2026) — habilitado depois de confirmar
  // na documentação oficial do ML que /advertising/{SITE}/product_ads/ads/
  // {ITEM_ID} entrega `cost` por anúncio. O gasto por SKU é dado real; o
  // que acontece aqui é dividir esse gasto entre os pedidos daquele SKU.
  describe('custo de Ads por pedido', () => {
    it('divide o gasto real do SKU entre as unidades vendidas no período', async () => {
      const { orchestrator } = buildOrchestrator(
        [
          buildLine({ orderId: 'o1', items: [item('SKU-1', 3)] }),
          buildLine({ orderId: 'o2', items: [item('SKU-1', 1)] }),
        ],
        [],
        [],
        [{ skuCode: 'SKU-1', channelCode: 'NUVEMSHOP', spend: 120, attributedUnits: 2 }],
      );

      const report = await orchestrator.generateDreReport('tenant-1');

      // 4 unidades vendidas, R$120 de mídia => R$30/unidade.
      const o1 = report.orderLines.find((l) => l.orderId === 'o1');
      const o2 = report.orderLines.find((l) => l.orderId === 'o2');
      expect(o1?.custoAdsRateado).toBeCloseTo(90, 2);
      expect(o2?.custoAdsRateado).toBeCloseTo(30, 2);
    });

    it('o rateio soma exatamente o gasto do SKU — nada some nem se duplica', async () => {
      const { orchestrator } = buildOrchestrator(
        [
          buildLine({ orderId: 'o1', items: [item('SKU-1', 3)] }),
          buildLine({ orderId: 'o2', items: [item('SKU-1', 1)] }),
        ],
        [],
        [],
        [{ skuCode: 'SKU-1', channelCode: 'NUVEMSHOP', spend: 120, attributedUnits: 2 }],
      );

      const report = await orchestrator.generateDreReport('tenant-1');
      const somaRateada = report.orderLines.reduce((s, l) => s + l.custoAdsRateado, 0);

      expect(somaRateada).toBeCloseTo(120, 2);
    });

    it('margemLiquida do pedido continua SEM Ads — a nova coluna é aditiva', async () => {
      const { orchestrator } = buildOrchestrator(
        [buildLine({ orderId: 'o1', totalAmount: 1000, items: [item('SKU-1', 1)] })],
        [],
        [],
        [{ skuCode: 'SKU-1', channelCode: 'NUVEMSHOP', spend: 100, attributedUnits: 1 }],
      );

      const report = await orchestrator.generateDreReport('tenant-1');
      const linha = report.orderLines[0];

      expect(linha.custoAdsRateado).toBeCloseTo(100, 2);
      expect(linha.margemLiquidaAposAds).toBeCloseTo(linha.margemLiquida - 100, 2);
    });

    it('SKU sem gasto de Ads não recebe custo nenhum', async () => {
      const { orchestrator } = buildOrchestrator(
        [buildLine({ orderId: 'o1', items: [item('SKU-SEM-ADS', 2)] })],
        [],
        [],
        [{ skuCode: 'SKU-1', channelCode: 'NUVEMSHOP', spend: 500, attributedUnits: 5 }],
      );

      const report = await orchestrator.generateDreReport('tenant-1');

      expect(report.orderLines[0].custoAdsRateado).toBe(0);
    });

    it('gasto em SKU que não vendeu no período não é atribuído a pedido nenhum', async () => {
      // O dinheiro não some do relatório — continua no custoAds do canal.
      // Só não onera pedido algum, que é a verdade: a mídia não converteu.
      const { orchestrator } = buildOrchestrator(
        [buildLine({ orderId: 'o1', items: [item('SKU-1', 1)] })],
        [],
        [],
        [{ skuCode: 'SKU-QUE-NAO-VENDEU', channelCode: 'NUVEMSHOP', spend: 300, attributedUnits: 0 }],
      );

      const report = await orchestrator.generateDreReport('tenant-1');

      expect(report.orderLines[0].custoAdsRateado).toBe(0);
    });

    it('sem captura por item, o rateio fica zerado — nunca estimado a partir do canal', async () => {
      const { orchestrator } = buildOrchestrator(
        [buildLine({ orderId: 'o1', items: [item('SKU-1', 1)] })],
        [{ channelCode: 'NUVEMSHOP', spend: 500, hasData: true }],
        [],
        [], // sem dado por SKU
      );

      const report = await orchestrator.generateDreReport('tenant-1');

      // O canal sabe que gastou R$500, mas sem gasto por anúncio não há
      // base honesta para dizer quanto foi de cada pedido.
      expect(report.custoAds).toBe(500);
      expect(report.orderLines[0].custoAdsRateado).toBe(0);
    });
  });

  // Despesas fixas e resultado operacional (01/08/2026, §3 da revisão) — o
  // relatório se chamava DRE mas parava na margem de contribuição.
  describe('despesas fixas', () => {
    const aluguel: FixedExpense = {
      id: 'exp-1',
      tenantId: 'tenant-1',
      name: 'Aluguel',
      amount: 3000,
      recurrenceType: 'MONTHLY',
      dueDay: 5,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };

    it('rateia a despesa no período e chega ao resultado operacional', async () => {
      const { orchestrator } = buildOrchestrator([buildLine({ totalAmount: 10000 })], [], [aluguel]);

      const report = await orchestrator.generateDreReport(
        'tenant-1',
        new Date('2026-07-01T00:00:00Z'),
        new Date('2026-07-31T00:00:00Z'),
      );

      // Julho tem 31 dias e o período é o mês fechado — despesa cheia.
      expect(report.despesasFixas).toBeCloseTo(3000, 2);
      expect(report.resultadoOperacional).toBeCloseTo(report.margemAposAds - 3000, 2);
      expect(report.despesasFixasApuradas).toBe(true);
    });

    it('período ABERTO não rateia nada e sinaliza — nunca inventa um número', async () => {
      const { orchestrator } = buildOrchestrator([buildLine()], [], [aluguel]);

      // Sem dateFrom/dateTo: não existe "quanto do aluguel pertence a um
      // intervalo sem fim".
      const report = await orchestrator.generateDreReport('tenant-1');

      expect(report.despesasFixas).toBe(0);
      expect(report.despesasFixasApuradas).toBe(false);
      expect(report.resultadoOperacional).toBe(report.margemAposAds);
    });

    it('NÃO altera margem de contribuição nem margem após Ads — extensão aditiva', async () => {
      const sem = await buildOrchestrator([buildLine({ totalAmount: 10000 })]).orchestrator.generateDreReport(
        't',
        new Date('2026-07-01T00:00:00Z'),
        new Date('2026-07-31T00:00:00Z'),
      );
      const com = await buildOrchestrator(
        [buildLine({ totalAmount: 10000 })],
        [],
        [aluguel],
      ).orchestrator.generateDreReport('t', new Date('2026-07-01T00:00:00Z'), new Date('2026-07-31T00:00:00Z'));

      expect(com.margemContribuicao).toBe(sem.margemContribuicao);
      expect(com.margemAposAds).toBe(sem.margemAposAds);
    });
  });

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
