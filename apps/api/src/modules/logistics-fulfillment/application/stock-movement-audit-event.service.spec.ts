import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StockMovementAuditEventService } from './stock-movement-audit-event.service';
import { StockMovementAuditEventRepository } from './ports/stock-movement-audit-event-repository.port';
import { StockMovementAuditEventItemRepository } from './ports/stock-movement-audit-event-item-repository.port';
import { OrderFinancialsReader } from '../../../shared/contracts/order-financials-reader.port';
import { StockMovementAuditEvent, StockMovementAuditEventItem } from '../domain/stock-movement-audit-event.entity';

function buildEvent(overrides: Partial<StockMovementAuditEvent> = {}): StockMovementAuditEvent {
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

function buildChecklistItem(overrides: Partial<StockMovementAuditEventItem> = {}): StockMovementAuditEventItem {
  return {
    id: 'item-1',
    tenantId: 'tenant-1',
    auditEventId: 'event-1',
    skuCode: 'SKU-1',
    expectedQuantity: 2,
    scannedQuantity: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('StockMovementAuditEventService', () => {
  function buildService(event: StockMovementAuditEvent | null) {
    const events: jest.Mocked<StockMovementAuditEventRepository> = {
      create: jest.fn().mockResolvedValue(event ?? buildEvent()),
      findById: jest.fn().mockResolvedValue(event),
      findByOrderId: jest.fn(),
      attachMedia: jest.fn(),
      approveWithLedger: jest.fn(),
      markDivergent: jest.fn(),
      findPending: jest.fn().mockResolvedValue([]),
    };
    const checklistItems: jest.Mocked<StockMovementAuditEventItemRepository> = {
      createMany: jest.fn().mockResolvedValue([]),
      findByAuditEvent: jest.fn().mockResolvedValue([]),
      findOneBySku: jest.fn().mockResolvedValue(null),
      incrementScanned: jest.fn(),
    };
    const orderItemsReader: jest.Mocked<OrderFinancialsReader> = {
      listForPeriod: jest.fn(),
      findItemsForOrders: jest.fn().mockResolvedValue([]),
    };
    const alerts = { emitAlert: jest.fn() };
    const service = new StockMovementAuditEventService(events, checklistItems, orderItemsReader, alerts);
    return { service, events, checklistItems, orderItemsReader, alerts };
  }

  describe('createPending — Sprint 27: montagem do checklist de bipagem', () => {
    it('sem orderIds (reabastecimento preventivo): não consulta itens nem cria checklist', async () => {
      const { service, orderItemsReader, checklistItems } = buildService(null);

      await service.createPending({ tenantId: 'tenant-1', eventType: 'FULL_DISPATCH', sourceWarehouseId: 'wh-1', orderIds: [] });

      expect(orderItemsReader.findItemsForOrders).not.toHaveBeenCalled();
      expect(checklistItems.createMany).not.toHaveBeenCalled();
    });

    it('com orderIds: busca os itens dos pedidos e cria o checklist agregado por SKU', async () => {
      const { service, orderItemsReader, checklistItems } = buildService(null);
      orderItemsReader.findItemsForOrders.mockResolvedValue([
        { orderId: 'order-1', skuCode: 'SKU-1', quantity: 2 },
        { orderId: 'order-1', skuCode: 'SKU-2', quantity: 1 },
      ]);

      await service.createPending({ tenantId: 'tenant-1', eventType: 'RETAIL_SHIPMENT', sourceWarehouseId: 'wh-1', orderIds: ['order-1'] });

      expect(orderItemsReader.findItemsForOrders).toHaveBeenCalledWith('tenant-1', ['order-1']);
      expect(checklistItems.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ tenantId: 'tenant-1', auditEventId: 'event-1', skuCode: 'SKU-1', expectedQuantity: 2 }),
        expect.objectContaining({ tenantId: 'tenant-1', auditEventId: 'event-1', skuCode: 'SKU-2', expectedQuantity: 1 }),
      ]);
    });

    it('itens sem SKU resolvido ficam fora do checklist, mas não impedem a criação do evento', async () => {
      const { service, checklistItems, orderItemsReader } = buildService(null);
      orderItemsReader.findItemsForOrders.mockResolvedValue([{ orderId: 'order-1', skuCode: null, quantity: 1 }]);

      const result = await service.createPending({
        tenantId: 'tenant-1',
        eventType: 'RETAIL_SHIPMENT',
        sourceWarehouseId: 'wh-1',
        orderIds: ['order-1'],
      });

      expect(result).toBeDefined();
      expect(checklistItems.createMany).not.toHaveBeenCalled();
    });
  });

  describe('scanItem — Sprint 27: bipagem individual', () => {
    it('recusa bipar um SKU fora do checklist deste evento', async () => {
      const { service, checklistItems } = buildService(buildEvent());
      checklistItems.findOneBySku.mockResolvedValue(null);

      await expect(service.scanItem('tenant-1', 'event-1', 'SKU-FORA')).rejects.toThrow(BadRequestException);
      expect(checklistItems.incrementScanned).not.toHaveBeenCalled();
    });

    it('recusa bipar além da quantidade esperada', async () => {
      const { service, checklistItems } = buildService(buildEvent());
      checklistItems.findOneBySku.mockResolvedValue(buildChecklistItem({ expectedQuantity: 1, scannedQuantity: 1 }));

      await expect(service.scanItem('tenant-1', 'event-1', 'SKU-1')).rejects.toThrow(BadRequestException);
      expect(checklistItems.incrementScanned).not.toHaveBeenCalled();
    });

    it('bipagem válida: incrementa a linha do checklist', async () => {
      const { service, checklistItems } = buildService(buildEvent());
      const item = buildChecklistItem({ expectedQuantity: 2, scannedQuantity: 0 });
      checklistItems.findOneBySku.mockResolvedValue(item);
      checklistItems.incrementScanned.mockResolvedValue({ ...item, scannedQuantity: 1 });

      await service.scanItem('tenant-1', 'event-1', 'SKU-1');

      expect(checklistItems.incrementScanned).toHaveBeenCalledWith('item-1');
    });

    it('recusa bipar num evento que já saiu de PENDENTE', async () => {
      const { service } = buildService(buildEvent({ conferenceStatus: 'APROVADO' }));
      await expect(service.scanItem('tenant-1', 'event-1', 'SKU-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('attachMedia', () => {
    it('recusa anexar mídia num evento que já saiu de PENDENTE', async () => {
      const { service } = buildService(buildEvent({ conferenceStatus: 'APROVADO' }));
      await expect(service.attachMedia('tenant-1', 'event-1', 'url', 'PHOTO')).rejects.toThrow(BadRequestException);
    });

    it('evento inexistente: lança NotFoundException', async () => {
      const { service } = buildService(null);
      await expect(service.attachMedia('tenant-1', 'event-1', 'url', 'PHOTO')).rejects.toThrow(NotFoundException);
    });

    it('evento PENDENTE: delega ao repositório', async () => {
      const { service, events } = buildService(buildEvent());
      events.attachMedia.mockResolvedValue(buildEvent({ mediaUrl: 'url' }));
      await service.attachMedia('tenant-1', 'event-1', 'url', 'PHOTO');
      expect(events.attachMedia).toHaveBeenCalledWith('event-1', 'url', 'PHOTO');
    });
  });

  describe('approve — a regra de ouro (Sprint 24 + checklist da Sprint 27)', () => {
    it('recusa aprovar sem mídia anexada, NUNCA chama approveWithLedger', async () => {
      const { service, events } = buildService(buildEvent({ mediaUrl: null }));

      await expect(service.approve('tenant-1', 'event-1', 'user-1', [{ skuCode: 'SKU-1', quantity: 1 }])).rejects.toThrow(
        BadRequestException,
      );
      expect(events.approveWithLedger).not.toHaveBeenCalled();
    });

    it('recusa aprovar sem nenhuma linha de SKU/quantidade informada', async () => {
      const { service, events } = buildService(buildEvent({ mediaUrl: 'url' }));

      await expect(service.approve('tenant-1', 'event-1', 'user-1', [])).rejects.toThrow(BadRequestException);
      expect(events.approveWithLedger).not.toHaveBeenCalled();
    });

    it('recusa aprovar um evento que já foi decidido (APROVADO ou DIVERGENTE)', async () => {
      const { service, events } = buildService(buildEvent({ mediaUrl: 'url', conferenceStatus: 'DIVERGENTE' }));

      await expect(service.approve('tenant-1', 'event-1', 'user-1', [{ skuCode: 'SKU-1', quantity: 1 }])).rejects.toThrow(
        BadRequestException,
      );
      expect(events.approveWithLedger).not.toHaveBeenCalled();
    });

    it('Sprint 27: recusa aprovar com mídia OK mas checklist incompleto', async () => {
      const { service, events, checklistItems } = buildService(buildEvent({ mediaUrl: 'url' }));
      checklistItems.findByAuditEvent.mockResolvedValue([buildChecklistItem({ expectedQuantity: 2, scannedQuantity: 1 })]);

      await expect(service.approve('tenant-1', 'event-1', 'user-1', [{ skuCode: 'SKU-1', quantity: 2 }])).rejects.toThrow(
        BadRequestException,
      );
      expect(events.approveWithLedger).not.toHaveBeenCalled();
    });

    it('com mídia anexada, checklist 100% bipado e ao menos um SKU: grava o ledger correto (débito físico + crédito virtual em FULL_DISPATCH)', async () => {
      const event = buildEvent({ eventType: 'FULL_DISPATCH', destinationWarehouseId: 'wh-cd-full-ml', mediaUrl: 'url' });
      const { service, events, checklistItems } = buildService(event);
      checklistItems.findByAuditEvent.mockResolvedValue([buildChecklistItem({ expectedQuantity: 4, scannedQuantity: 4 })]);
      events.approveWithLedger.mockResolvedValue({ ...event, conferenceStatus: 'APROVADO' });

      await service.approve('tenant-1', 'event-1', 'user-1', [{ skuCode: 'SKU-1', quantity: 4 }]);

      expect(events.approveWithLedger).toHaveBeenCalledWith(
        'event-1',
        'user-1',
        expect.arrayContaining([
          expect.objectContaining({ warehouseId: 'wh-physical', quantityDelta: -4 }),
          expect.objectContaining({ warehouseId: 'wh-cd-full-ml', quantityDelta: 4 }),
        ]),
      );
    });

    it('checklist vazio (reabastecimento preventivo): aprova só com mídia — comportamento legado da Sprint 24', async () => {
      const event = buildEvent({ mediaUrl: 'url', orderIds: [] });
      const { service, events, checklistItems } = buildService(event);
      checklistItems.findByAuditEvent.mockResolvedValue([]);
      events.approveWithLedger.mockResolvedValue({ ...event, conferenceStatus: 'APROVADO' });

      await service.approve('tenant-1', 'event-1', 'user-1', [{ skuCode: 'SKU-1', quantity: 1 }]);

      expect(events.approveWithLedger).toHaveBeenCalled();
    });
  });

  describe('markDivergent', () => {
    it('nunca grava ledger e sempre emite um alerta técnico ERROR', async () => {
      const event = buildEvent();
      const { service, events, alerts } = buildService(event);
      events.markDivergent.mockResolvedValue({ ...event, conferenceStatus: 'DIVERGENTE', divergenceNotes: 'faltou 1 unidade' });

      await service.markDivergent('tenant-1', 'event-1', 'user-1', 'faltou 1 unidade');

      expect(events.approveWithLedger).not.toHaveBeenCalled();
      expect(alerts.emitAlert).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'StockMovementAuditEvent', severity: 'ERROR' }),
      );
    });

    it('recusa marcar divergente um evento que já foi decidido antes', async () => {
      const { service } = buildService(buildEvent({ conferenceStatus: 'APROVADO' }));
      await expect(service.markDivergent('tenant-1', 'event-1', 'user-1', 'nota')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getPendingQueue — Sprint 27: fila de trabalho da tela de conferência', () => {
    it('delega ao repositório (findPending, já ordenado FIFO)', async () => {
      const { service, events } = buildService(null);
      const pending = [buildEvent({ id: 'event-a' }), buildEvent({ id: 'event-b' })];
      events.findPending.mockResolvedValue(pending);

      const result = await service.getPendingQueue('tenant-1');

      expect(events.findPending).toHaveBeenCalledWith('tenant-1');
      expect(result).toBe(pending);
    });
  });
});
