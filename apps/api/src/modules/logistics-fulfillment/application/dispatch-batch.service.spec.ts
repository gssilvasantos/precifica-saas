import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DispatchBatchService } from './dispatch-batch.service';
import { DispatchBatchRepository } from './ports/dispatch-batch-repository.port';
import { DispatchBatchOrderRepository } from './ports/dispatch-batch-order-repository.port';
import { StockMovementAuditEventRepository } from './ports/stock-movement-audit-event-repository.port';
import { OrderFiscalReader } from '../../../shared/contracts/order-fiscal-reader.port';
import { OrderProviderRegistry } from '../../orders/application/order-provider-registry.service';
import { FreightProviderRegistry } from '../../freight-shipping/application/freight-provider-registry.service';
import { DispatchBatch, DispatchBatchOrder } from '../domain/dispatch-batch.entity';

function buildBatch(overrides: Partial<DispatchBatch> = {}): DispatchBatch {
  return {
    id: 'batch-1',
    tenantId: 'tenant-1',
    formaEnvio: 'CORREIOS',
    status: 'ABERTO',
    requestedByUserId: 'user-1',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    concludedAt: null,
    ...overrides,
  };
}

function buildLink(overrides: Partial<DispatchBatchOrder> = {}): DispatchBatchOrder {
  return {
    id: 'link-1',
    tenantId: 'tenant-1',
    dispatchBatchId: 'batch-1',
    orderId: 'order-1',
    status: 'PENDENTE',
    externalLabelId: null,
    trackingCode: null,
    labelUrl: null,
    errorMessage: null,
    labeledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('DispatchBatchService (Fase 5, Expedição em lote)', () => {
  function buildService() {
    const batches: jest.Mocked<DispatchBatchRepository> = {
      create: jest.fn().mockResolvedValue(buildBatch()),
      findById: jest.fn().mockResolvedValue(buildBatch()),
      findAllByTenant: jest.fn(),
      updateStatus: jest.fn().mockImplementation(async (id, status) => buildBatch({ id, status })),
    };
    const batchOrders: jest.Mocked<DispatchBatchOrderRepository> = {
      add: jest.fn().mockResolvedValue(buildLink()),
      findById: jest.fn().mockResolvedValue(buildLink()),
      findAllByBatch: jest.fn(),
      findActiveByOrder: jest.fn().mockResolvedValue(null),
      remove: jest.fn(),
      markLabeled: jest.fn().mockImplementation(async (id, data) => buildLink({ id, status: 'ETIQUETADO', ...data })),
      markError: jest.fn().mockImplementation(async (id, errorMessage) => buildLink({ id, status: 'ERRO', errorMessage })),
    };
    const auditEvents: jest.Mocked<StockMovementAuditEventRepository> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn().mockResolvedValue({ eventType: 'RETAIL_SHIPMENT', conferenceStatus: 'APROVADO' }),
      attachMedia: jest.fn(),
      approveWithLedger: jest.fn(),
      markDivergent: jest.fn(),
      findPending: jest.fn(),
    } as unknown as jest.Mocked<StockMovementAuditEventRepository>;
    const orderReader: jest.Mocked<OrderFiscalReader> = {
      getForFiscalEmission: jest.fn().mockResolvedValue({
        orderId: 'order-1',
        channelCode: 'MERCADO_LIVRE',
        externalOrderId: 'ML-999',
        status: 'PREPARANDO_ENVIO',
        buyerTaxId: null,
        totalAmount: 100,
        shippingAmount: 0,
        discountAmount: 0,
        items: [],
      }),
    };
    const orderProviders = { findByMarketplaceCode: jest.fn().mockReturnValue([]) } as unknown as jest.Mocked<OrderProviderRegistry>;
    const freightProviders = { findByProviderCode: jest.fn().mockReturnValue(undefined) } as unknown as jest.Mocked<FreightProviderRegistry>;

    const service = new DispatchBatchService(batches, batchOrders, auditEvents, orderReader, orderProviders, freightProviders);
    return { service, batches, batchOrders, auditEvents, orderReader, orderProviders, freightProviders };
  }

  describe('createBatch', () => {
    it('rejeita formaEnvio vazia', async () => {
      const { service } = buildService();
      await expect(service.createBatch('tenant-1', '   ')).rejects.toThrow(BadRequestException);
    });

    it('normaliza formaEnvio para maiúsculas', async () => {
      const { service, batches } = buildService();
      await service.createBatch('tenant-1', 'correios');
      expect(batches.create).toHaveBeenCalledWith(expect.objectContaining({ formaEnvio: 'CORREIOS' }));
    });
  });

  describe('addOrder', () => {
    it('rejeita lote inexistente', async () => {
      const { service, batches } = buildService();
      batches.findById.mockResolvedValue(null);
      await expect(service.addOrder('tenant-1', 'batch-x', 'order-1')).rejects.toThrow(NotFoundException);
    });

    it('rejeita pedido sem conferência do Pick & Pack aprovada', async () => {
      const { service, auditEvents } = buildService();
      auditEvents.findByOrderId.mockResolvedValue(null);
      await expect(service.addOrder('tenant-1', 'batch-1', 'order-1')).rejects.toThrow(BadRequestException);
    });

    it('rejeita pedido já em outro lote ativo', async () => {
      const { service, batchOrders } = buildService();
      batchOrders.findActiveByOrder.mockResolvedValue(buildLink({ dispatchBatchId: 'outro-lote' }));
      await expect(service.addOrder('tenant-1', 'batch-1', 'order-1')).rejects.toThrow(BadRequestException);
    });

    it('adiciona com sucesso quando elegível', async () => {
      const { service, batchOrders } = buildService();
      const result = await service.addOrder('tenant-1', 'batch-1', 'order-1');
      expect(batchOrders.add).toHaveBeenCalledWith('tenant-1', 'batch-1', 'order-1');
      expect(result.status).toBe('PENDENTE');
    });
  });

  describe('generateLabel', () => {
    it('forma de envio NONE: rejeita (usar concluir direto)', async () => {
      const { service, batches } = buildService();
      batches.findById.mockResolvedValue(buildBatch({ formaEnvio: 'RETIRAR_PESSOALMENTE' }));
      await expect(service.generateLabel('tenant-1', 'batch-1', 'link-1')).rejects.toThrow(BadRequestException);
    });

    it('NATIVE_MARKETPLACE: canal do pedido diferente do exigido — marca ERRO', async () => {
      const { service, batches, batchOrders, orderReader } = buildService();
      batches.findById.mockResolvedValue(buildBatch({ formaEnvio: 'MERCADO_ENVIOS' }));
      orderReader.getForFiscalEmission.mockResolvedValue({
        orderId: 'order-1',
        channelCode: 'SHOPEE',
        externalOrderId: 'SHP-1',
        status: 'PREPARANDO_ENVIO',
        buyerTaxId: null,
        totalAmount: 100,
        shippingAmount: 0,
        discountAmount: 0,
        items: [],
      });

      const result = await service.generateLabel('tenant-1', 'batch-1', 'link-1');

      expect(batchOrders.markError).toHaveBeenCalled();
      expect(result.status).toBe('ERRO');
    });

    it('NATIVE_MARKETPLACE: sem provider registrado para o canal — marca ERRO', async () => {
      const { service, batches, batchOrders } = buildService();
      batches.findById.mockResolvedValue(buildBatch({ formaEnvio: 'MERCADO_ENVIOS' }));

      const result = await service.generateLabel('tenant-1', 'batch-1', 'link-1');

      expect(batchOrders.markError).toHaveBeenCalled();
      expect(result.status).toBe('ERRO');
    });

    it('NATIVE_MARKETPLACE: sucesso marca ETIQUETADO', async () => {
      const { service, batches, batchOrders, orderProviders } = buildService();
      batches.findById.mockResolvedValue(buildBatch({ formaEnvio: 'MERCADO_ENVIOS' }));
      const provider = {
        capabilities: ['ORDERS', 'SHIPPING_LABEL'],
        getShippingLabel: jest.fn().mockResolvedValue({ success: true, trackingCode: 'BR123', labelUrl: 'https://x' }),
      };
      orderProviders.findByMarketplaceCode.mockReturnValue([provider] as never);

      const result = await service.generateLabel('tenant-1', 'batch-1', 'link-1');

      expect(provider.getShippingLabel).toHaveBeenCalledWith({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' }, 'ML-999');
      expect(batchOrders.markLabeled).toHaveBeenCalledWith('link-1', { trackingCode: 'BR123', labelUrl: 'https://x' });
      expect(result.status).toBe('ETIQUETADO');
    });

    it('GENERIC_FREIGHT: sem manualInput — marca ERRO', async () => {
      const { service, batchOrders } = buildService();
      const result = await service.generateLabel('tenant-1', 'batch-1', 'link-1');
      expect(batchOrders.markError).toHaveBeenCalled();
      expect(result.status).toBe('ERRO');
    });

    it('GENERIC_FREIGHT: sem conexão configurada para o provider — marca ERRO', async () => {
      const { service, batchOrders } = buildService();
      const result = await service.generateLabel('tenant-1', 'batch-1', 'link-1', {
        packageWeightKg: 1,
        recipientAddress: {
          name: 'Cliente',
          street: 'Rua X',
          number: '10',
          neighborhood: 'Centro',
          city: 'SP',
          state: 'SP',
          postalCode: '01000000',
        },
      });
      expect(batchOrders.markError).toHaveBeenCalled();
      expect(result.status).toBe('ERRO');
    });

    it('GENERIC_FREIGHT: sucesso marca ETIQUETADO', async () => {
      const { service, batchOrders, freightProviders } = buildService();
      const provider = {
        providerCode: 'CORREIOS',
        generateLabel: jest.fn().mockResolvedValue({ success: true, trackingCode: 'OB123', labelUrl: 'data:application/pdf;base64,xxx' }),
      };
      freightProviders.findByProviderCode.mockReturnValue(provider as never);

      const result = await service.generateLabel('tenant-1', 'batch-1', 'link-1', {
        packageWeightKg: 1,
        recipientAddress: {
          name: 'Cliente',
          street: 'Rua X',
          number: '10',
          neighborhood: 'Centro',
          city: 'SP',
          state: 'SP',
          postalCode: '01000000',
        },
      });

      expect(provider.generateLabel).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ orderReference: 'ML-999', packageWeightKg: 1 }));
      expect(batchOrders.markLabeled).toHaveBeenCalledWith('link-1', { trackingCode: 'OB123', labelUrl: 'data:application/pdf;base64,xxx' });
      expect(result.status).toBe('ETIQUETADO');
    });

    // Quick Win 6 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
    // seção 1.6/2) — avisoRecebimento/maoPropria repassados do manualInput
    // para o provider genérico.
    it('GENERIC_FREIGHT: repassa avisoRecebimento/maoPropria do manualInput para o provider', async () => {
      const { service, freightProviders } = buildService();
      const provider = {
        providerCode: 'CORREIOS',
        generateLabel: jest.fn().mockResolvedValue({ success: true, trackingCode: 'OB123' }),
      };
      freightProviders.findByProviderCode.mockReturnValue(provider as never);

      await service.generateLabel('tenant-1', 'batch-1', 'link-1', {
        packageWeightKg: 1,
        avisoRecebimento: true,
        maoPropria: true,
        recipientAddress: {
          name: 'Cliente',
          street: 'Rua X',
          number: '10',
          neighborhood: 'Centro',
          city: 'SP',
          state: 'SP',
          postalCode: '01000000',
        },
      });

      expect(provider.generateLabel).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ avisoRecebimento: true, maoPropria: true }),
      );
    });

    it('rejeita se o pedido já estiver ETIQUETADO (evita gerar de novo sem remover antes)', async () => {
      const { service, batchOrders } = buildService();
      batchOrders.findById.mockResolvedValue(buildLink({ status: 'ETIQUETADO' }));
      await expect(service.generateLabel('tenant-1', 'batch-1', 'link-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('concludeBatch', () => {
    it('rejeita lote sem pedidos', async () => {
      const { service, batchOrders } = buildService();
      batchOrders.findAllByBatch.mockResolvedValue([]);
      await expect(service.concludeBatch('tenant-1', 'batch-1')).rejects.toThrow(BadRequestException);
    });

    it('conclui com sucesso quando todo pedido está ETIQUETADO', async () => {
      const { service, batchOrders, batches } = buildService();
      batchOrders.findAllByBatch.mockResolvedValue([buildLink({ status: 'ETIQUETADO' })]);

      const result = await service.concludeBatch('tenant-1', 'batch-1');

      expect(batches.updateStatus).toHaveBeenCalledWith('batch-1', 'DESPACHADO', expect.any(Date));
      expect(result.status).toBe('DESPACHADO');
    });
  });

  describe('cancelBatch', () => {
    it('cancela um lote ABERTO', async () => {
      const { service, batches } = buildService();
      const result = await service.cancelBatch('tenant-1', 'batch-1');
      expect(batches.updateStatus).toHaveBeenCalledWith('batch-1', 'CANCELADO');
      expect(result.status).toBe('CANCELADO');
    });

    it('rejeita cancelar um lote já DESPACHADO', async () => {
      const { service, batches } = buildService();
      batches.findById.mockResolvedValue(buildBatch({ status: 'DESPACHADO' }));
      await expect(service.cancelBatch('tenant-1', 'batch-1')).rejects.toThrow(BadRequestException);
    });
  });
});
