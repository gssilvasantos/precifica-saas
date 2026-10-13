import { Inject, Injectable, Logger } from '@nestjs/common';
import { PRODUCT_CATALOG_READER, TAX_RATE_RESOLVER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { TaxRateResolver, TaxRateUnavailableError } from '../../../shared/contracts/tax-rate-resolver.port';
import { OrderFinancialLine, OrderFinancialLineItem } from '../../../shared/contracts/order-financials-reader.port';
import { computeItemTaxAmount } from '../domain/tax-amount';

// Preenche o imposto dos itens de pedido cujo taxAmount não foi gravado.
//
// Por que aqui e não no Orders: TaxIntelligenceModule importa OrdersModule
// (receita mensal para o RBT12); Orders importar Tax criaria ciclo. O DRE é o
// consumidor que precisa do número, então estima aqui, pela porta.
//
// Regras:
//  - taxAmount já gravado (não nulo) vence — nunca é sobrescrito.
//  - sem alíquota resolvível, o item fica com taxAmount null e um motivo; o DRE
//    marca INCOMPLETE. Nunca assume imposto zero (superestimaria a margem).
//  - resolução por (produto, mês do pedido): a alíquota do Simples muda por
//    mês (RBT12) e a regra de ST muda por data; dentro do mês é constante.
@Injectable()
export class DreTaxEstimator {
  private readonly logger = new Logger(DreTaxEstimator.name);

  constructor(
    @Inject(TAX_RATE_RESOLVER) private readonly resolver: TaxRateResolver,
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
  ) {}

  async enrich(tenantId: string, lines: OrderFinancialLine[]): Promise<OrderFinancialLine[]> {
    const productIdBySku = new Map<string, Promise<string | null>>();
    const rateByKey = new Map<string, Promise<{ rate: number } | { reason: string }>>();

    const productIdFor = (sku: string) => {
      let p = productIdBySku.get(sku);
      if (!p) {
        p = this.catalog.findBySku(tenantId, sku).then((s) => s?.productId ?? null);
        productIdBySku.set(sku, p);
      }
      return p;
    };

    const rateFor = (productId: string, orderedAt: Date) => {
      const at = new Date(Date.UTC(orderedAt.getUTCFullYear(), orderedAt.getUTCMonth(), 1));
      const key = `${productId}|${at.toISOString().slice(0, 7)}`;
      let p = rateByKey.get(key);
      if (!p) {
        p = this.resolver.resolve({ tenantId, productId, at }).then(
          (r) => ({ rate: r.effectiveRate }),
          (err: unknown) => {
            if (err instanceof TaxRateUnavailableError) return { reason: err.reason };
            this.logger.error(`Falha ao resolver alíquota (produto ${productId}, ${key.slice(-7)}): ${(err as Error).message}`);
            return { reason: 'ERRO_AO_RESOLVER_ALIQUOTA' };
          },
        );
        rateByKey.set(key, p);
      }
      return p;
    };

    const enrichItem = async (line: OrderFinancialLine, item: OrderFinancialLineItem): Promise<OrderFinancialLineItem> => {
      if (item.taxAmount !== null) return item;
      if (!item.skuCode) return { ...item, taxUnresolvedReason: 'item sem SKU' };
      const productId = await productIdFor(item.skuCode);
      if (!productId) return { ...item, taxUnresolvedReason: `SKU ${item.skuCode} não encontrado no catálogo` };
      const result = await rateFor(productId, line.orderedAt);
      if ('reason' in result) return { ...item, taxUnresolvedReason: result.reason };
      return { ...item, taxAmount: computeItemTaxAmount(item.totalPrice, result.rate), taxEstimated: true };
    };

    return Promise.all(
      lines.map(async (line) => ({ ...line, items: await Promise.all(line.items.map((i) => enrichItem(line, i))) })),
    );
  }
}
