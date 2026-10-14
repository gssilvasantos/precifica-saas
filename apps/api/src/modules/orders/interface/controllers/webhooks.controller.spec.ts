import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebhooksController } from './webhooks.controller';
import { OrderProviderRegistry } from '../../application/order-provider-registry.service';
import { OrderSyncOrchestrator } from '../../application/order-sync-orchestrator.service';
import { OrderCapableProvider } from '../../../../shared/contracts/marketplace-provider.contract';
import { WEBHOOK_EVENTS } from '../../domain/webhook-events';

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
    const events = new EventEmitter2();
    const emitSpy = jest.spyOn(events, 'emit');
    const controller = new WebhooksController(registry, orchestrator, events);
    return { controller, registry, orchestrator, events, emitSpy };
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

  it('emite WEBHOOK_EVENTS.RECEIVED com o canal normalizado e o topic do payload', async () => {
    const provider = buildProvider({ marketplaceCode: 'MERCADO_LIVRE', code: 'MERCADO_LIVRE_ORDERS' });
    const { controller, emitSpy } = buildController([provider]);

    await controller.receive('mercado_livre', { topic: 'payments', resource: '/payments/123' });

    expect(emitSpy).toHaveBeenCalledWith(WEBHOOK_EVENTS.RECEIVED, { channel: 'MERCADO_LIVRE', topic: 'payments' });
  });

  it('payload sem topic (ou topic não-string): emite o evento com topic undefined, nunca lança', async () => {
    const provider = buildProvider();
    const { controller, emitSpy } = buildController([provider]);

    await controller.receive('NUVEMSHOP', { topic: 123 });

    expect(emitSpy).toHaveBeenCalledWith(WEBHOOK_EVENTS.RECEIVED, { channel: 'NUVEMSHOP', topic: undefined });
  });

  it('topic desconhecido ainda assim dispara o sync incremental de pedidos (nenhuma regressão no caminho já em produção)', async () => {
    const provider = buildProvider();
    const { controller, orchestrator } = buildController([provider]);

    await controller.receive('NUVEMSHOP', { topic: 'messages' });

    expect(orchestrator.syncProvider).toHaveBeenCalledWith(provider.code);
  });
});
