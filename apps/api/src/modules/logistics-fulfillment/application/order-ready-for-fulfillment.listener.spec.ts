import { OrderReadyForFulfillmentListener } from './order-ready-for-fulfillment.listener';
import { StockMovementAuditEventService } from './stock-movement-audit-event.service';
import { WarehouseService } from './warehouse.service';
import { StockMovementAuditEventRepository } from './ports/stock-movement-audit-event-repository.port';
import { OrderReadyForFulfillmentEvent } from '../../orders/domain/order-events';
import { StockMovementAuditEvent } from '../domain/stock-movement-audit-event.entity';
import { Warehouse } from '../domain/warehouse.entity';

function buildPayload(overrides: Partial<OrderReadyForFulfillmentEvent> = {}): OrderReadyForFulfillmentEvent {
  return {
    tenantId: 'tenant-1',
    orderId: 'order-1',
    channelCode: 'NUVEMSHOP',
    externalOrderId: 'EXT-1',
    skuCodes: ['SKU-1'],
    ...overrides,
  };
}

function buildWarehouse(overrides: Partial<Warehouse> = {}): Warehouse {
  return {
    id: 'wh-physical',
    tenantId: 'tenant-1',
    code: 'FISICO',
    type: 'PHYSICAL',
    channelCode: null,
    isActive: true,
    leadTimeDays: 15,
    logisticsCostPerUnit: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildAuditEvent(overrides: Partial<StockMovementAuditEvent> = {}): StockMovementAuditEvent {
  return {
    id: 'event-1',
    tenantId: 'tenant-1',
    eventType: 'RETAIL_SHIPMENT',
    sourceWarehouseId: 'wh-physical',
    destinationWarehouseId: null,
    mediaUrl: null,
    mediaType: null,
    conferenceStatus: 'PENDENTE',
    conferredByUserId: null,
    conferredAt: null,
    divergenceNotes: null,
    invoiceNumber: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    orderIds: ['order-1'],
    ...overrides,
  };
}

describe('OrderReadyForFulfillmentListener', () => {
  function buildListener() {
    const eventsRepo: jest.Mocked<StockMovementAuditEventRepository> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn().mockResolvedValue(null),
      attachMedia: jest.fn(),
      approveWithLedger: jest.fn(),
      markDivergent: jest.fn(),
      findPending: jest.fn().mockResolvedValue([]),
    };
    const checklistItems = {
      createMany: jest.fn().mockResolvedValue([]),
      findByAuditEvent: jest.fn().mockResolvedValue([]),
      findOneBySku: jest.fn().mockResolvedValue(null),
      incrementScanned: jest.fn(),
    };
    const orderItemsReader = {
      listForPeriod: jest.fn(),
      findItemsForOrders: jest.fn().mockResolvedValue([]),
    };
    const alerts = { emitAlert: jest.fn() };
    const auditEvents = new StockMovementAuditEventService(eventsRepo, checklistItems, orderItemsReader, alerts);

    const warehouseRepo = {
      findById: jest.fn(),
      findByCode: jest.fn().mockResolvedValue(buildWarehouse()),
      findAllByTenant: jest.fn(),
      upsert: jest.fn(),
      updateLeadTimeDays: jest.fn(),
      updateLogisticsCostPerUnit: jest.fn(),
    };
    const warehouses = new WarehouseService(warehouseRepo);

    const listener = new OrderReadyForFulfillmentListener(auditEvents, warehouses, eventsRepo, alerts);
    return { listener, eventsRepo, warehouseRepo, alerts };
  }

  it('cria um StockMovementAuditEvent RETAIL_SHIPMENT PENDENTE vinculado ao pedido, no depósito físico do tenant', async () => {
    const { listener, eventsRepo } = buildListener();
    eventsRepo.create.mockResolvedValue(buildAuditEvent());

    await listener.handle(buildPayload());

    expect(eventsRepo.create).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      eventType: 'RETAIL_SHIPMENT',
      sourceWarehouseId: 'wh-physical',
      orderIds: ['order-1'],
    });
  });

  it('idempotência: pedido que já tem evento de auditoria não gera um segundo', async () => {
    const { listener, eventsRepo } = buildListener();
    eventsRepo.findByOrderId.mockResolvedValue(buildAuditEvent());

    await listener.handle(buildPayload());

    expect(eventsRepo.create).not.toHaveBeenCalled();
  });

  it('falha ao criar o evento: nunca lança, emite alerta técnico ERROR', async () => {
    const { listener, eventsRepo, alerts } = buildListener();
    eventsRepo.create.mockRejectedValue(new Error('db indisponível'));

    await expect(listener.handle(buildPayload())).resolves.toBeUndefined();

    expect(alerts.emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'OrderReadyForFulfillmentListener', severity: 'ERROR' }),
    );
  });
});
