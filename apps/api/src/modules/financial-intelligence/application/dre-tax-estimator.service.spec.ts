import { DreTaxEstimator } from './dre-tax-estimator.service';
import { OrderFinancialLine } from '../../../shared/contracts/order-financials-reader.port';
import { ResolvedTaxRate, TaxRateResolver, TaxRateUnavailableError } from '../../../shared/contracts/tax-rate-resolver.port';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { buildDreReport } from '../domain/dre-report';

const rate = (effectiveRate: number): ResolvedTaxRate => ({
  effectiveRate,
  incidence: 'POR_DENTRO',
  creditableRate: 0,
  regime: 'SIMPLES_NACIONAL',
  source: 'MANUAL_OVERRIDE',
  breakdown: {},
  fixedMonthlyTaxAmount: null,
});

const line = (over: Partial<OrderFinancialLine> = {}, taxAmount: number | null = null, sku: string | null = 'SKU-1'): OrderFinancialLine => ({
  orderId: 'o1',
  externalOrderId: 'E1',
  channelCode: 'MERCADO_LIVRE',
  status: 'ENTREGUE',
  orderedAt: new Date('2026-07-15T12:00:00Z'),
  totalAmount: 100,
  shippingAmount: 0,
  discountAmount: 0,
  feeAmount: 10,
  items: [{ skuCode: sku, quantity: 1, totalPrice: 100, taxAmount, costPriceUsed: 40, costKnown: true }],
  ...over,
});

function build(resolve: TaxRateResolver['resolve'], found = true) {
  const resolver: jest.Mocked<TaxRateResolver> = { resolve: jest.fn(resolve) };
  const catalog = {
    findBySku: jest.fn().mockResolvedValue(found ? { productId: 'p1' } : null),
  } as unknown as jest.Mocked<ProductCatalogReader>;
  return { est: new DreTaxEstimator(resolver, catalog), resolver, catalog };
}

describe('DreTaxEstimator', () => {
  it('calcula o imposto do item pela alíquota efetiva e marca como estimado', async () => {
    const { est } = build(async () => rate(0.073));
    const [out] = await est.enrich('t1', [line()]);
    expect(out.items[0]).toMatchObject({ taxAmount: 7.3, taxEstimated: true });
  });

  it('não sobrescreve taxAmount já gravado (inclusive 0)', async () => {
    const { est, resolver } = build(async () => rate(0.073));
    const [out] = await est.enrich('t1', [line({}, 0)]);
    expect(out.items[0].taxAmount).toBe(0);
    expect(out.items[0].taxEstimated).toBeUndefined();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('resolve uma vez por produto e mês, com tenant e data do 1º dia do mês', async () => {
    const { est, resolver, catalog } = build(async () => rate(0.07));
    await est.enrich('t1', [line(), line({ orderId: 'o2', orderedAt: new Date('2026-07-30T03:00:00Z') }), line({ orderId: 'o3', orderedAt: new Date('2026-08-02T12:00:00Z') })]);
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(resolver.resolve).toHaveBeenCalledWith({ tenantId: 't1', productId: 'p1', at: new Date('2026-07-01T00:00:00Z') });
    expect(catalog.findBySku).toHaveBeenCalledTimes(1);
  });

  it('alíquota indisponível deixa taxAmount null com o motivo — nunca zero', async () => {
    const { est } = build(async () => {
      throw new TaxRateUnavailableError('REGIME_NAO_CONFIGURADO', 'sem perfil');
    });
    const [out] = await est.enrich('t1', [line()]);
    expect(out.items[0]).toMatchObject({ taxAmount: null, taxUnresolvedReason: 'REGIME_NAO_CONFIGURADO' });
  });

  it('erro inesperado do resolvedor também vira motivo, sem derrubar o DRE', async () => {
    const { est } = build(async () => {
      throw new Error('boom');
    });
    const [out] = await est.enrich('t1', [line()]);
    expect(out.items[0].taxUnresolvedReason).toBe('ERRO_AO_RESOLVER_ALIQUOTA');
  });

  it('SKU ausente ou fora do catálogo vira motivo', async () => {
    const a = await build(async () => rate(0.07)).est.enrich('t1', [line({}, null, null)]);
    expect(a[0].items[0].taxUnresolvedReason).toBe('item sem SKU');
    const b = await build(async () => rate(0.07), false).est.enrich('t1', [line()]);
    expect(b[0].items[0].taxUnresolvedReason).toContain('não encontrado');
  });

  describe('integração com o DRE', () => {
    it('imposto estimado entra nas deduções e reduz a margem', async () => {
      const { est } = build(async () => rate(0.073));
      const report = buildDreReport('t1', await est.enrich('t1', [line()]), null, null, new Date('2026-08-01'), [], [], []);
      expect(report.channels[0].deducoes).toBeCloseTo(7.3);
      expect(report.channels[0].margemContribuicao).toBeCloseTo(100 - 7.3 - 40 - 10);
      expect(report.dataQuality).toBe('COMPLETE');
    });

    it('imposto não calculado marca o DRE e o pedido como INCOMPLETE com o motivo', async () => {
      const { est } = build(async () => {
        throw new TaxRateUnavailableError('RBT12_INCOMPLETO', 'x');
      });
      const report = buildDreReport('t1', await est.enrich('t1', [line()]), null, null, new Date('2026-08-01'), [], [], []);
      expect(report.dataQuality).toBe('INCOMPLETE');
      expect(report.channels[0].dataQuality).toBe('INCOMPLETE');
      expect(report.orderLines[0].dataQuality).toBe('INCOMPLETE');
      expect(report.incompleteOrders[0].reasons.join(' ')).toContain('RBT12_INCOMPLETO');
    });
  });
});
