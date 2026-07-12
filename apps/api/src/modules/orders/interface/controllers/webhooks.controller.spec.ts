import { NotFoundException } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { OrderProviderRegistry } from '../../application/order-provider-registry.service';
import { OrderSyncOrchestrator } from '../../application/order-sync-orchestrator.service';
import { OrderCapableProvider } from '../../../../shared/contracts/marketplace-provider.contract';

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

describe('WebhooksController', () => {
  function buildController(providers: OrderCapableProvider[]) {
    const registry = { findByMarketplaceCode: jest.fn().mockReturnValue(providers) } as unknown as jest.Mocked<OrderProviderRegistry>;
    const orchestrator = { syncProvider: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<OrderSyncOrchestrator>;
    const controller = new WebhooksController(registry, orchestrator);
    return { controller, registry, orchestrator };
  }

  it('resolve o canal via marketplaceCode e dispara sync incremental do provider correspondente', async () => {
    const provider = buildProvider();
    const { controller, registry, orchestrator } = buildController([provider]);

    const result = await controller.receive('NUVEMSHOP', { some: 'payload' });

    expect(registry.findByMarketplaceCode).toHaveBeenCalledWith('NUVEMSHOP');
    expect(orchestrator.syncProvider).toHaveBeenCalledWith('NUVEMSHOP_ORDERS');
    expect(result).toMatchObject({ received: true, channel: 'NUVEMSHOP', providersSynced: ['NUVEMSHOP_ORDERS'] });
  });

  it('canal com múltiplos providers registrados: dispara sync para todos', async () => {
    const providerA = buildProvider({ code: 'A' });
    const providerB = buildProvider({ code: 'B' });
    const { controller, orchestrator } = buildController([providerA, providerB]);

    await controller.receive('NUVEMSHOP', {});

    expect(orchestrator.syncProvider).toHaveBeenCalledTimes(2);
    expect(orchestrator.syncProvider).toHaveBeenCalledWith('A');
    expect(orchestrator.syncProvider).toHaveBeenCalledWith('B');
  });

  it('canal desconhecido: lança NotFoundException, nunca chama o orquestrador', async () => {
    const { controller, orchestrator } = buildController([]);

    await expect(controller.receive('CANAL_INEXISTENTE', {})).rejects.toThrow(NotFoundException);
    expect(orchestrator.syncProvider).not.toHaveBeenCalled();
  });

  it('nunca lê/desserializa o payload do corpo — só usa a chegada como nudge', async () => {
    const provider = buildProvider();
    const { controller, orchestrator } = buildController([provider]);

    await controller.receive('NUVEMSHOP', { qualquerCoisa: 'nao deveria ser inspecionado' });

    expect(orchestrator.syncProvider).toHaveBeenCalledWith(provider.code);
  });
});
