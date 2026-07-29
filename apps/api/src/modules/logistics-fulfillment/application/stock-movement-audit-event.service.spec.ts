import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StockMovementAuditEventService } from './stock-movement-audit-event.service';
import { StockMovementAuditEventRepository } from './ports/stock-movement-audit-event-repository.port';
import { StockMovementAuditEventItemRepository } from './ports/stock-movement-audit-event-item-repository.port';
import { StockLedgerRepository } from './ports/stock-ledger-repository.port';
import { OrderFinancialsReader } from '../../../shared/contracts/order-financials-reader.port';
import { ProductLotReader } from '../../../shared/contracts/product-lot-reader.port';
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
    notes: null,
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
      listReservedByWarehouse: jest.fn().mockResolvedValue([]),
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
    const ledger: jest.Mocked<StockLedgerRepository> = {
      getBalance: jest.fn().mockResolvedValue(0),
      listBalancesByWarehouse: jest.fn().mockResolvedValue([]),
      listBalancesByLot: jest.fn().mockResolvedValue([]),
    };
    const lotReader: jest.Mocked<ProductLotReader> = {
      getLots: jest.fn().mockResolvedValue([]),
      findLot: jest.fn().mockResolvedValue({ lotCode: 'L1', dataValidade: new Date('2026-12-01'), diasPermitidoVenda: 0, status: 'ATIVO' }),
    };
    const service = new StockMovementAuditEventService(events, checklistItems, orderItemsReader, alerts, ledger, lotReader);
    return { service, events, checklistItems, orderItemsReader, alerts, ledger, lotReader };
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

  describe('receivePurchase — Ordem de Compra (Fase 1): entrada de mercadoria comprada', () => {
    it('cria e aprova o evento no mesmo passo, gerando ledger de CRÉDITO', async () => {
      const pendingEvent = buildEvent({
        eventType: 'PURCHASE_RECEIPT',
        invoiceNumber: 'NF-123',
        destinationWarehouseId: null,
      });
      const { service, events } = buildService(pendingEvent);
      events.create.mockResolvedValue(pendingEvent);
      events.approveWithLedger.mockResolvedValue({ ...pendingEvent, conferenceStatus: 'APROVADO' });

      const result = await service.receivePurchase('tenant-1', 'wh-physical', 'NF-123', 'user-1', [
        { skuCode: 'SKU-1', quantity: 10 },
      ]);

      expect(events.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', eventType: 'PURCHASE_RECEIPT', sourceWarehouseId: 'wh-physical', invoiceNumber: 'NF-123' }),
      );
      expect(events.approveWithLedger).toHaveBeenCalledWith(
        pendingEvent.id,
        'user-1',
        expect.arrayContaining([expect.objectContaining({ warehouseId: 'wh-physical', skuCode: 'SKU-1', quantityDelta: 10 })]),
      );
      expect(result).toEqual({ auditEventId: pendingEvent.id });
    });

    it('rejeita lista de linhas vazia sem tocar o repositório', async () => {
      const { service, events } = buildService(null);
      await expect(service.receivePurchase('tenant-1', 'wh-physical', 'NF-123', 'user-1', [])).rejects.toThrow(BadRequestException);
      expect(events.create).not.toHaveBeenCalled();
    });

    it('propaga a recusa do gate (sem invoiceNumber) sem gravar ledger', async () => {
      const pendingEvent = buildEvent({ eventType: 'PURCHASE_RECEIPT', invoiceNumber: null });
      const { service, events } = buildService(pendingEvent);
      events.create.mockResolvedValue(pendingEvent);

      await expect(
        service.receivePurchase('tenant-1', 'wh-physical', '', 'user-1', [{ skuCode: 'SKU-1', quantity: 1 }]),
      ).rejects.toThrow(BadRequestException);
      expect(events.approveWithLedger).not.toHaveBeenCalled();
    });
  });

  describe('produceOutput — Ordem de Produção (Projeto Estruturante 1): conclusão debita componentes e credita o produto acabado', () => {
    it('cria e aprova o evento no mesmo passo, gerando débito dos componentes + crédito do produto acabado', async () => {
      const pendingEvent = buildEvent({
        eventType: 'PRODUCTION_OUTPUT',
        sourceWarehouseId: 'wh-physical',
        destinationWarehouseId: 'wh-physical',
      });
      const { service, events } = buildService(pendingEvent);
      events.create.mockResolvedValue(pendingEvent);
      events.approveWithLedger.mockResolvedValue({ ...pendingEvent, conferenceStatus: 'APROVADO' });

      const result = await service.produceOutput(
        'tenant-1',
        'wh-physical',
        'wh-physical',
        'user-1',
        [{ skuCode: 'COMPONENTE-1', quantity: 20 }],
        { skuCode: 'KIT-1', quantity: 10 },
      );

      expect(events.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'PRODUCTION_OUTPUT',
          sourceWarehouseId: 'wh-physical',
          destinationWarehouseId: 'wh-physical',
        }),
      );
      expect(events.approveWithLedger).toHaveBeenCalledWith(
        pendingEvent.id,
        'user-1',
        expect.arrayContaining([
          expect.objectContaining({ warehouseId: 'wh-physical', skuCode: 'COMPONENTE-1', quantityDelta: -20 }),
          expect.objectContaining({ warehouseId: 'wh-physical', skuCode: 'KIT-1', quantityDelta: 10 }),
        ]),
      );
      expect(result).toEqual({ auditEventId: pendingEvent.id });
    });

    it('rejeita lista de componentes vazia sem tocar o repositório', async () => {
      const { service, events } = buildService(null);
      await expect(
        service.produceOutput('tenant-1', 'wh-physical', 'wh-physical', 'user-1', [], { skuCode: 'KIT-1', quantity: 1 }),
      ).rejects.toThrow(BadRequestException);
      expect(events.create).not.toHaveBeenCalled();
    });
  });

  describe('adjustLot — Produtos-Lotes (Projeto Estruturante 2): lançamento manual por lote', () => {
    it('rejeita lotCode que não existe para o SKU/tenant, sem criar evento', async () => {
      const { service, events, lotReader } = buildService(null);
      lotReader.findLot.mockResolvedValue(null);

      await expect(
        service.adjustLot('tenant-1', 'wh-physical', 'SKU-1', 'L-INEXISTENTE', 'ENTRADA', 10, 'user-1', 'justificativa'),
      ).rejects.toThrow(BadRequestException);
      expect(events.create).not.toHaveBeenCalled();
    });

    it('ENTRADA: cria e aprova gerando crédito (positivo) no ledger, com lotCode', async () => {
      const pendingEvent = buildEvent({ eventType: 'LOT_ADJUSTMENT', sourceWarehouseId: 'wh-physical', notes: 'entrada avulsa' });
      const { service, events } = buildService(pendingEvent);
      events.create.mockResolvedValue(pendingEvent);
      events.approveWithLedger.mockResolvedValue({ ...pendingEvent, conferenceStatus: 'APROVADO' });

      const result = await service.adjustLot('tenant-1', 'wh-physical', 'SKU-1', 'L1', 'ENTRADA', 10, 'user-1', 'entrada avulsa');

      expect(events.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', eventType: 'LOT_ADJUSTMENT', sourceWarehouseId: 'wh-physical', notes: 'entrada avulsa' }),
      );
      expect(events.approveWithLedger).toHaveBeenCalledWith(pendingEvent.id, 'user-1', [
        expect.objectContaining({ warehouseId: 'wh-physical', skuCode: 'SKU-1', lotCode: 'L1', quantityDelta: 10 }),
      ]);
      expect(result).toEqual({ auditEventId: pendingEvent.id });
    });

    it('SAIDA: gera débito (negativo) no ledger', async () => {
      const pendingEvent = buildEvent({ eventType: 'LOT_ADJUSTMENT', notes: 'baixa de vencido' });
      const { service, events } = buildService(pendingEvent);
      events.create.mockResolvedValue(pendingEvent);
      events.approveWithLedger.mockResolvedValue({ ...pendingEvent, conferenceStatus: 'APROVADO' });

      await service.adjustLot('tenant-1', 'wh-physical', 'SKU-1', 'L1', 'SAIDA', 5, 'user-1', 'baixa de vencido');

      expect(events.approveWithLedger).toHaveBeenCalledWith(pendingEvent.id, 'user-1', [
        expect.objectContaining({ quantityDelta: -5 }),
      ]);
    });

    it('BALANCO: calcula o delta contra o saldo atual DAQUELE LOTE (não o SKU inteiro)', async () => {
      const pendingEvent = buildEvent({ eventType: 'LOT_ADJUSTMENT', notes: 'contagem física' });
      const { service, events, ledger } = buildService(pendingEvent);
      events.create.mockResolvedValue(pendingEvent);
      events.approveWithLedger.mockResolvedValue({ ...pendingEvent, conferenceStatus: 'APROVADO' });
      // Dois lotes do mesmo SKU no mesmo depósito — só o saldo de L1 pode
      // entrar na conta do BALANCO de L1.
      ledger.listBalancesByLot.mockResolvedValue([
        { lotCode: 'L1', balance: 8 },
        { lotCode: 'L2', balance: 100 },
      ]);

      await service.adjustLot('tenant-1', 'wh-physical', 'SKU-1', 'L1', 'BALANCO', 6, 'user-1', 'contagem física');

      expect(events.approveWithLedger).toHaveBeenCalledWith(pendingEvent.id, 'user-1', [
        expect.objectContaining({ quantityDelta: -2 }),
      ]);
    });

    it('rejeita sem justificativa (notes vazio), sem gravar ledger', async () => {
      const pendingEvent = buildEvent({ eventType: 'LOT_ADJUSTMENT', notes: null });
      const { service, events } = buildService(pendingEvent);
      events.create.mockResolvedValue(pendingEvent);

      await expect(
        service.adjustLot('tenant-1', 'wh-physical', 'SKU-1', 'L1', 'ENTRADA', 10, 'user-1', ''),
      ).rejects.toThrow(BadRequestException);
      expect(events.approveWithLedger).not.toHaveBeenCalled();
    });
  });
});
