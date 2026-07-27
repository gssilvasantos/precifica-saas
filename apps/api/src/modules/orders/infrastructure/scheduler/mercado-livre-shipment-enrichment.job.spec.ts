import { MercadoLivreShipmentEnrichmentJob } from './mercado-livre-shipment-enrichment.job';
import { OrderRepository } from '../../application/ports/order-repository.port';
import { OrderSyncOrchestrator } from '../../application/order-sync-orchestrator.service';
import { MercadoLivreApiClient } from '../../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../marketplace-intelligence/application/mercado-livre-connection.service';
import { Order } from '../../domain/order.entity';

function buildPendingOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    channelCode: 'MERCADO_LIVRE',
    externalOrderId: '123',
    status: 'PREPARANDO_ENVIO',
    externalStatus: 'paid',
    subtotalAmount: 100,
    shippingAmount: 0,
    discountAmount: 0,
    totalAmount: 100,
    feeAmount: 0,
    netAmount: 100,
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
    shippingStatusCheckedAt: null,
    rawPayload: {
      id: 123,
      status: 'paid',
      total_amount: 100,
      currency_id: 'BRL',
      date_created: '2026-07-01T00:00:00.000Z',
      shipping: { id: 555 },
      order_items: [{ item: { id: 'MLB1', seller_sku: 'SKU-1' }, quantity: 1, unit_price: 100 }],
    },
    items: [],
    ...overrides,
  };
}

describe('MercadoLivreShipmentEnrichmentJob (Reestruturação do sync ML, 25-26/07/2026)', () => {
  function buildJob() {
    const orders: jest.Mocked<Pick<OrderRepository, 'findPendingShipmentEnrichment'>> = {
      findPendingShipmentEnrichment: jest.fn().mockResolvedValue([]),
    };
    const client = { fetchShipmentStatus: jest.fn() } as unknown as jest.Mocked<MercadoLivreApiClient>;
    const connection = {
      listActiveTenantIds: jest.fn().mockResolvedValue(['tenant-1']),
      getValidAccessToken: jest.fn().mockResolvedValue('access-token'),
    } as unknown as jest.Mocked<MercadoLivreConnectionService>;
    const orchestrator = { upsertAndEmit: jest.fn() } as unknown as jest.Mocked<OrderSyncOrchestrator>;

    const job = new MercadoLivreShipmentEnrichmentJob(orders as unknown as OrderRepository, client, connection, orchestrator);
    return { job, orders, client, connection, orchestrator };
  }

  it('sem pedidos pendentes: não consulta token nem envio', async () => {
    const { job, connection, client } = buildJob();

    await job.run();

    expect(connection.getValidAccessToken).not.toHaveBeenCalled();
    expect(client.fetchShipmentStatus).not.toHaveBeenCalled();
  });

  it('shipment confirmado como ENTREGUE: marca shippingStatusCheckedAt (não precisa mais checar)', async () => {
    const { job, orders, client, orchestrator } = buildJob();
    orders.findPendingShipmentEnrichment.mockResolvedValue([buildPendingOrder()]);
    client.fetchShipmentStatus.mockResolvedValue({ status: 'delivered', substatus: null });

    await job.run();

    expect(client.fetchShipmentStatus).toHaveBeenCalledWith('555', 'access-token');
    expect(orchestrator.upsertAndEmit).toHaveBeenCalledWith(
      'tenant-1',
      'MERCADO_LIVRE',
      expect.objectContaining({ externalOrderId: '123', status: 'ENTREGUE' }),
      expect.objectContaining({ shippingStatusCheckedAt: expect.any(Date) }),
    );
  });

  it('shipment ainda em preparação (ex.: "handling"): NÃO marca shippingStatusCheckedAt — continua na fila', async () => {
    const { job, orders, client, orchestrator } = buildJob();
    orders.findPendingShipmentEnrichment.mockResolvedValue([buildPendingOrder()]);
    client.fetchShipmentStatus.mockResolvedValue({ status: 'handling', substatus: null });

    await job.run();

    expect(orchestrator.upsertAndEmit).toHaveBeenCalledWith(
      'tenant-1',
      'MERCADO_LIVRE',
      expect.objectContaining({ status: 'PREPARANDO_ENVIO' }),
      undefined,
    );
  });

  it('fetchShipmentStatus devolve null (sem info nova): não faz upsert, deixa pendente pra próxima execução', async () => {
    const { job, orders, client, orchestrator } = buildJob();
    orders.findPendingShipmentEnrichment.mockResolvedValue([buildPendingOrder()]);
    client.fetchShipmentStatus.mockResolvedValue(null);

    await job.run();

    expect(orchestrator.upsertAndEmit).not.toHaveBeenCalled();
  });

  it('pedido sem shipping.id no payload: marca como conferido sem chamar fetchShipmentStatus', async () => {
    const { job, orders, client, orchestrator } = buildJob();
    orders.findPendingShipmentEnrichment.mockResolvedValue([
      buildPendingOrder({ rawPayload: { id: 123, status: 'paid', total_amount: 100, currency_id: 'BRL', date_created: '2026-07-01T00:00:00.000Z' } }),
    ]);

    await job.run();

    expect(client.fetchShipmentStatus).not.toHaveBeenCalled();
    expect(orchestrator.upsertAndEmit).toHaveBeenCalledWith(
      'tenant-1',
      'MERCADO_LIVRE',
      expect.anything(),
      expect.objectContaining({ shippingStatusCheckedAt: expect.any(Date) }),
    );
  });

  it('sem token válido para o tenant: pula o tenant sem lançar', async () => {
    const { job, orders, connection, client } = buildJob();
    orders.findPendingShipmentEnrichment.mockResolvedValue([buildPendingOrder()]);
    connection.getValidAccessToken.mockRejectedValue(new Error('sem conexão'));

    await expect(job.run()).resolves.toBeUndefined();
    expect(client.fetchShipmentStatus).not.toHaveBeenCalled();
  });

  it('falha ao enriquecer um pedido não interrompe os demais do lote', async () => {
    const { job, orders, client, orchestrator } = buildJob();
    orders.findPendingShipmentEnrichment.mockResolvedValue([
      buildPendingOrder({ externalOrderId: '1', rawPayload: { id: 1, status: 'paid', shipping: { id: 1 } } }),
      buildPendingOrder({ externalOrderId: '2', rawPayload: { id: 2, status: 'paid', shipping: { id: 2 } } }),
    ]);
    client.fetchShipmentStatus
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ status: 'delivered', substatus: null });

    await expect(job.run()).resolves.toBeUndefined();
    expect(orchestrator.upsertAndEmit).toHaveBeenCalledTimes(1);
  });
});
