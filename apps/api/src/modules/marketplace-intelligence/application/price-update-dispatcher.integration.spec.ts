import { Test } from '@nestjs/testing';
import { MarketplaceProviderRegistry, MARKETPLACE_PROVIDERS } from './marketplace-provider-registry.service';
import { PriceUpdateDispatcherService } from './price-update-dispatcher.service';
import {
  FetchContext,
  MarketplaceProvider,
  PriceUpdateCapableProvider,
  PriceUpdateResult,
  ProviderCapability,
  ProviderHealthStatus,
} from '../../../shared/contracts/marketplace-provider.contract';

// Teste de INTEGRAÇÃO (não unitário): monta o DI real do Nest para
// MarketplaceProviderRegistry + PriceUpdateDispatcherService — as duas
// classes de verdade, coladas uma na outra exatamente como em produção.
// Só o que cruza a borda do sistema (o provider concreto de cada canal) é
// substituído por um dublê. É a "garantia de qualidade" pedida: qualquer
// provider novo que respeitar PriceUpdateCapableProvider vai se comportar
// como este dublê aqui do ponto de vista do Dispatcher.

class MockPriceUpdateProvider implements MarketplaceProvider, PriceUpdateCapableProvider {
  readonly code = 'MOCK_PROVIDER';
  readonly marketplaceCode = 'MOCK_MARKETPLACE';
  readonly sourceType = 'MANUAL' as const;
  readonly capabilities = [ProviderCapability.PRICE_UPDATE];

  updatePrice = jest.fn(
    async (_ctx: FetchContext, externalId: string, newPrice: number): Promise<PriceUpdateResult> => ({
      success: true,
      externalId,
      appliedPrice: newPrice,
    }),
  );

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'UP' };
  }
}

// Provider registrado, porém sem a capacidade PRICE_UPDATE — simula um canal
// que já existe no sistema (ex.: só tem FEE_RULES, como o Mercado Livre hoje
// antes de ganhar OAuth de escrita) mas ainda não sabe escrever preço.
class MockReadOnlyProvider implements MarketplaceProvider {
  readonly code = 'MOCK_READ_ONLY_PROVIDER';
  readonly marketplaceCode = 'MOCK_READ_ONLY_MARKETPLACE';
  readonly sourceType = 'MANUAL' as const;
  readonly capabilities: ProviderCapability[] = [];

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'UP' };
  }
}

describe('PriceUpdateDispatcher (integração com MarketplaceProviderRegistry)', () => {
  let mockProvider: MockPriceUpdateProvider;
  let dispatcher: PriceUpdateDispatcherService;

  beforeEach(async () => {
    mockProvider = new MockPriceUpdateProvider();
    const readOnlyProvider = new MockReadOnlyProvider();

    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketplaceProviderRegistry,
        PriceUpdateDispatcherService,
        { provide: MARKETPLACE_PROVIDERS, useValue: [mockProvider, readOnlyProvider] },
      ],
    }).compile();

    dispatcher = moduleRef.get(PriceUpdateDispatcherService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('cenário de sucesso: encontra o provider certo e executa updatePrice() com os parâmetros corretos', async () => {
    const result = await dispatcher.dispatch({
      tenantId: 'tenant-1',
      marketplaceCode: 'MOCK_MARKETPLACE',
      skuCode: 'SKU-001',
      externalId: 'listing-abc',
      newPrice: 129.9,
    });

    expect(mockProvider.updatePrice).toHaveBeenCalledTimes(1);
    expect(mockProvider.updatePrice).toHaveBeenCalledWith(
      { marketplaceCode: 'MOCK_MARKETPLACE', tenantId: 'tenant-1' },
      'listing-abc',
      129.9,
    );
    expect(result).toEqual({
      success: true,
      externalId: 'listing-abc',
      appliedPrice: 129.9,
      message: undefined,
    });
  });

  it('cenário de proteção: marketplace não registrado retorna { success: false }, sem lançar exceção', async () => {
    const result = await dispatcher.dispatch({
      tenantId: 'tenant-1',
      marketplaceCode: 'CANAL_INEXISTENTE',
      skuCode: 'SKU-002',
      externalId: 'listing-xyz',
      newPrice: 50,
    });

    expect(mockProvider.updatePrice).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.externalId).toBe('listing-xyz');
    expect(result.message).toMatch(/não tem um provider com suporte a atualização de preço/);
  });

  it('cenário de proteção: marketplace registrado mas sem capacidade de escrita retorna { success: false }, sem lançar exceção', async () => {
    const result = await dispatcher.dispatch({
      tenantId: 'tenant-1',
      marketplaceCode: 'MOCK_READ_ONLY_MARKETPLACE',
      skuCode: 'SKU-003',
      externalId: 'listing-ghi',
      newPrice: 80,
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/não tem um provider com suporte a atualização de preço/);
  });

  it('cenário de proteção: erro de infraestrutura no provider também vira { success: false }, nunca propaga a exceção', async () => {
    mockProvider.updatePrice.mockRejectedValueOnce(new Error('timeout ao chamar a API do canal'));

    const result = await dispatcher.dispatch({
      tenantId: 'tenant-1',
      marketplaceCode: 'MOCK_MARKETPLACE',
      skuCode: 'SKU-004',
      externalId: 'listing-def',
      newPrice: 75,
    });

    expect(result).toEqual({
      success: false,
      externalId: 'listing-def',
      message: 'timeout ao chamar a API do canal',
    });
  });
});
