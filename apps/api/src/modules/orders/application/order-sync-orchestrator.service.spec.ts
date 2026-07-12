import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderSyncOrchestrator } from './order-sync-orchestrator.service';
import { OrderProviderRegistry } from './order-provider-registry.service';
import { OrderRepository, OrderUpsertResult } from './ports/order-repository.port';
import { ProviderSyncLogRepository } from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import { ProviderHealthRepository } from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { Order, OrderStatus } from '../domain/order.entity';
import { OrderCapableProvider, RawOrderCandidate } from '../../../shared/contracts/marketplace-provider.contract';

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    channelCode: 'NUVEMSHOP',
    externalOrderId: 'EXT-1',
    status: 'PREPARANDO_ENVIO',
    externalStatus: 'open/paid',
    subtotalAmount: 100,
    shippingAmount: 10,
    discountAmount: 0,
    totalAmount: 110,
    feeAmount: 0,
    netAmount: 110,
    currency: 'BRL',
    fiscalResponsibility: 'SELLER',
    buyerTaxId: null,
    invoiceNumber: null,
    shippingDeadlineAt: null,
    orderedAt: new Date('2026-07-01'),
    paidAt: new Date('2026-07-01'),
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    syncedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    isDemo: false,
    items: [{ id: 'item-1', orderId: 'order-1', skuCode: 'SKU-1', externalSku: 'EXT-SKU-1', productName: 'Produto', quantity: 1, unitPrice: 100, totalPrice: 100, taxAmount: null, costPrice: null }],
    ...overrides,
  };
}

function buildRawOrder(overrides: Partial<RawOrderCandidate> = {}): RawOrderCandidate {
  return {
    externalOrderId: 'EXT-1',
    status: 'PREPARANDO_ENVIO',
    externalStatus: 'open/paid',
    subtotalAmount: 100,
    shippingAmount: 10,
    discountAmount: 0,
    totalAmount: 110,
    feeAmount: 0,
    netAmount: 110,
    currency: 'BRL',
    orderedAt: new Date('2026-07-01'),
    items: [{ externalSku: 'EXT-SKU-1', productName: 'Produto', quantity: 1, unitPrice: 100, totalPrice: 100 }],
    ...overrides,
  };
}

describe('OrderSyncOrchestrator', () => {
  function buildOrchestrator(options: {
    provider?: OrderCapableProvider | undefined;
    rawOrders?: RawOrderCandidate[];
    previousStatus?: OrderStatus | null;
    fetchOrdersImpl?: () => Promise<RawOrderCandidate[]>;
  }) {
    const registry = { findByCode: jest.fn().mockReturnValue(options.provider) } as unknown as jest.Mocked<OrderProviderRegistry>;

    const upsertResult: OrderUpsertResult = {
      order: buildOrder(),
      isNew: false,
      previousStatus: options.previousStatus ?? 'EM_ABERTO',
    };
    const orderRepository: jest.Mocked<OrderRepository> = {
      upsert: jest.fn().mockResolvedValue(upsertResult),
      findById: jest.fn(),
      findWithFilters: jest.fn(),
      countByStatus: jest.fn(),
      findAllForPeriod: jest.fn(),
      deleteDemoOrders: jest.fn(),
      findItemsByOrderIds: jest.fn().mockResolvedValue([]),
    };

    const syncLogs: jest.Mocked<ProviderSyncLogRepository> = {
      start: jest.fn().mockResolvedValue('log-1'),
      finish: jest.fn(),
    };

    const health: jest.Mocked<ProviderHealthRepository> = {
      recordSuccess: jest.fn(),
      recordFailure: jest.fn().mockResolvedValue(1),
    };

    const catalog: jest.Mocked<ProductCatalogReader> = {
      findBySku: jest.fn().mockResolvedValue({
        productId: 'prod-1',
        skuCode: 'SKU-1',
        name: 'Produto',
        costPrice: 50,
        productCostPrice: 50,
        packagingCostPrice: null,
        desiredMarginPct: 20,
        minimumMarginPct: 8,
        autoRepricingEnabled: false,
        packagingId: null,
        isKit: false,
      }),
    };

    const events = new EventEmitter2();
    const emitSpy = jest.spyOn(events, 'emit');

    const alerts = { emitAlert: jest.fn() };

    const orchestrator = new OrderSyncOrchestrator(registry, orderRepository, syncLogs, health, catalog, events, alerts);
    return { orchestrator, registry, orderRepository, syncLogs, health, catalog, emitSpy, alerts };
  }

  function buildProvider(overrides: Partial<OrderCapableProvider> = {}): OrderCapableProvider {
    return {
      code: 'NUVEMSHOP_ORDERS',
      marketplaceCode: 'NUVEMSHOP',
      sourceType: 'OFFICIAL_API',
      capabilities: [],
      healthCheck: jest.fn(),
      listTenantIdsToSync: jest.fn().mockResolvedValue(['tenant-1']),
      fetchOrders: jest.fn().mockResolvedValue([buildRawOrder()]),
      ...overrides,
    };
  }

  it('provider não registrado: loga aviso e não faz nada', async () => {
    const { orchestrator, orderRepository } = buildOrchestrator({ provider: undefined });

    await orchestrator.syncProvider('DESCONHECIDO');

    expect(orderRepository.upsert).not.toHaveBeenCalled();
  });

  it('provider sem listTenantIdsToSync: loga aviso e não faz nada (pedido é sempre por tenant)', async () => {
    const provider = buildProvider({ listTenantIdsToSync: undefined });
    const { orchestrator, orderRepository } = buildOrchestrator({ provider });

    await orchestrator.syncProvider('NUVEMSHOP_ORDERS');

    expect(orderRepository.upsert).not.toHaveBeenCalled();
  });

  it('sincroniza com sucesso: busca pedidos, resolve SKU, faz upsert e registra saúde/log', async () => {
    const provider = buildProvider();
    const { orchestrator, orderRepository, health, syncLogs, catalog } = buildOrchestrator({ provider });

    await orchestrator.syncProvider('NUVEMSHOP_ORDERS');

    expect(catalog.findBySku).toHaveBeenCalledWith('tenant-1', 'EXT-SKU-1');
    expect(orderRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', channelCode: 'NUVEMSHOP', externalOrderId: 'EXT-1' }),
    );
    expect(health.recordSuccess).toHaveBeenCalledWith('NUVEMSHOP_ORDERS');
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'SUCCESS', candidatesFound: 1, candidatesApplied: 1 }));
  });

  it('Etapa 19: grava o costPrice efetivo do catálogo como snapshot no item, no momento do sync', async () => {
    const provider = buildProvider();
    const { orchestrator, orderRepository } = buildOrchestrator({ provider });

    await orchestrator.syncProvider('NUVEMSHOP_ORDERS');

    expect(orderRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ externalSku: 'EXT-SKU-1', skuCode: 'SKU-1', costPrice: 50 })],
      }),
    );
  });

  it('Etapa 19: item sem match no catálogo fica sem costPrice (nunca inventa um custo)', async () => {
    const provider = buildProvider();
    const { orchestrator, orderRepository, catalog } = buildOrchestrator({ provider });
    catalog.findBySku.mockResolvedValue(null);

    await orchestrator.syncProvider('NUVEMSHOP_ORDERS');

    expect(orderRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ skuCode: undefined, costPrice: undefined })],
      }),
    );
  });

  it('emite ORDER_EVENTS.PAID quando o pedido sai de EM_ABERTO pela primeira vez', async () => {
    const provider = buildProvider();
    const { orchestrator, emitSpy } = buildOrchestrator({ provider, previousStatus: 'EM_ABERTO' });

    await orchestrator.syncProvider('NUVEMSHOP_ORDERS');

    expect(emitSpy).toHaveBeenCalledWith('orders.order-paid', expect.objectContaining({ tenantId: 'tenant-1', externalOrderId: 'EXT-1' }));
  });

  it('não emite PAID de novo quando o pedido já tinha saído de EM_ABERTO antes', async () => {
    const provider = buildProvider();
    const { orchestrator, emitSpy } = buildOrchestrator({ provider, previousStatus: 'PREPARANDO_ENVIO' });

    await orchestrator.syncProvider('NUVEMSHOP_ORDERS');

    expect(emitSpy).not.toHaveBeenCalledWith('orders.order-paid', expect.anything());
  });

  it('emite ORDER_EVENTS.CANCELLED quando o pedido transiciona para CANCELADO', async () => {
    const provider = buildProvider({ fetchOrders: jest.fn().mockResolvedValue([buildRawOrder({ status: 'CANCELADO' })]) });
    const { orchestrator, emitSpy, orderRepository } = buildOrchestrator({ provider, previousStatus: 'PREPARANDO_ENVIO' });
    orderRepository.upsert.mockResolvedValue({
      order: buildOrder({ status: 'CANCELADO', cancelledAt: new Date('2026-07-05') }),
      isNew: false,
      previousStatus: 'PREPARANDO_ENVIO',
    });

    await orchestrator.syncProvider('NUVEMSHOP_ORDERS');

    expect(emitSpy).toHaveBeenCalledWith('orders.order-cancelled', expect.objectContaining({ externalOrderId: 'EXT-1' }));
  });

  it('uma falha ao processar um pedido individual não impede os demais de serem processados', async () => {
    const provider = buildProvider({ fetchOrders: jest.fn().mockResolvedValue([buildRawOrder({ externalOrderId: 'EXT-1' }), buildRawOrder({ externalOrderId: 'EXT-2' })]) });
    const { orchestrator, orderRepository, syncLogs, alerts } = buildOrchestrator({ provider });
    orderRepository.upsert
      .mockRejectedValueOnce(new Error('falha pontual'))
      .mockResolvedValueOnce({ order: buildOrder({ externalOrderId: 'EXT-2' }), isNew: false, previousStatus: 'EM_ABERTO' });

    await orchestrator.syncProvider('NUVEMSHOP_ORDERS');

    expect(orderRepository.upsert).toHaveBeenCalledTimes(2);
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'SUCCESS', candidatesFound: 2, candidatesApplied: 1 }));
    expect(alerts.emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'OrderSyncOrchestrator', severity: 'WARNING', context: expect.objectContaining({ externalOrderId: 'EXT-1' }) }),
    );
  });

  it('falha ao buscar pedidos do provider: registra falha de saúde e log FAILED, não lança, e emite alerta ERROR', async () => {
    const provider = buildProvider({ fetchOrders: jest.fn().mockRejectedValue(new Error('API fora do ar')) });
    const { orchestrator, health, syncLogs, alerts } = buildOrchestrator({ provider });

    await expect(orchestrator.syncProvider('NUVEMSHOP_ORDERS')).resolves.toBeUndefined();

    expect(health.recordFailure).toHaveBeenCalledWith('NUVEMSHOP_ORDERS', 'API fora do ar');
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'FAILED' }));
    expect(alerts.emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'OrderSyncOrchestrator', severity: 'ERROR', context: expect.objectContaining({ providerCode: 'NUVEMSHOP_ORDERS' }) }),
    );
  });
});
