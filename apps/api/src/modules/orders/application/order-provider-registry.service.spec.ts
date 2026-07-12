import { OrderProviderRegistry } from './order-provider-registry.service';
import { OrderCapableProvider } from '../../../shared/contracts/marketplace-provider.contract';

function buildProvider(overrides: Partial<OrderCapableProvider> = {}): OrderCapableProvider {
  return {
    code: 'NUVEMSHOP_ORDERS',
    marketplaceCode: 'NUVEMSHOP',
    sourceType: 'OFFICIAL_API',
    capabilities: [],
    healthCheck: jest.fn(),
    fetchOrders: jest.fn(),
    ...overrides,
  };
}

describe('OrderProviderRegistry', () => {
  it('findByCode encontra pelo código interno do provider', () => {
    const provider = buildProvider();
    const registry = new OrderProviderRegistry([provider]);

    expect(registry.findByCode('NUVEMSHOP_ORDERS')).toBe(provider);
    expect(registry.findByCode('DESCONHECIDO')).toBeUndefined();
  });

  it('findByMarketplaceCode encontra pelo canal, case-insensitive', () => {
    const provider = buildProvider({ marketplaceCode: 'MERCADO_LIVRE' });
    const registry = new OrderProviderRegistry([provider]);

    expect(registry.findByMarketplaceCode('MERCADO_LIVRE')).toEqual([provider]);
    expect(registry.findByMarketplaceCode('mercado_livre')).toEqual([provider]);
  });

  it('findByMarketplaceCode devolve [] para canal sem provider registrado', () => {
    const registry = new OrderProviderRegistry([buildProvider()]);

    expect(registry.findByMarketplaceCode('SHOPEE')).toEqual([]);
  });

  it('findByMarketplaceCode devolve todos os providers de um mesmo canal (1:N)', () => {
    const providerA = buildProvider({ code: 'A', marketplaceCode: 'NUVEMSHOP' });
    const providerB = buildProvider({ code: 'B', marketplaceCode: 'NUVEMSHOP' });
    const registry = new OrderProviderRegistry([providerA, providerB]);

    expect(registry.findByMarketplaceCode('NUVEMSHOP')).toEqual([providerA, providerB]);
  });
});
