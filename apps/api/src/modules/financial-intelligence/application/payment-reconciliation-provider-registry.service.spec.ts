import { PaymentReconciliationProviderRegistry } from './payment-reconciliation-provider-registry.service';
import { PaymentReconciliationCapableProvider } from '../../../shared/contracts/marketplace-provider.contract';

function buildProvider(overrides: Partial<PaymentReconciliationCapableProvider> = {}): PaymentReconciliationCapableProvider {
  return {
    code: 'MERCADO_LIVRE_PAYMENTS',
    marketplaceCode: 'MERCADO_LIVRE',
    sourceType: 'OFFICIAL_API',
    capabilities: [],
    healthCheck: jest.fn(),
    fetchSettledPayments: jest.fn(),
    ...overrides,
  };
}

describe('PaymentReconciliationProviderRegistry', () => {
  it('findByCode: retorna o provider pelo código interno', () => {
    const provider = buildProvider();
    const registry = new PaymentReconciliationProviderRegistry([provider]);

    expect(registry.findByCode('MERCADO_LIVRE_PAYMENTS')).toBe(provider);
    expect(registry.findByCode('INEXISTENTE')).toBeUndefined();
  });

  it('findByMarketplaceCode: filtra por canal, normalizando para maiúsculas', () => {
    const ml = buildProvider();
    const other = buildProvider({ code: 'OUTRO', marketplaceCode: 'SHOPEE' });
    const registry = new PaymentReconciliationProviderRegistry([ml, other]);

    expect(registry.findByMarketplaceCode('mercado_livre')).toEqual([ml]);
    expect(registry.findByMarketplaceCode('SHOPEE')).toEqual([other]);
    expect(registry.findByMarketplaceCode('NUVEMSHOP')).toEqual([]);
  });
});
