import { ReceivableFromOrderListener } from './receivable-from-order.listener';
import { ReceivableRecordRepository } from './ports/receivable-record-repository.port';
import { ReceivableRecord } from '../domain/receivable-record.entity';
import { OrderCancelledEvent, OrderPaidEvent } from '../../orders/domain/order-events';

describe('ReceivableFromOrderListener', () => {
  const existingReceivable: ReceivableRecord = {
    id: 'rec-1',
    tenantId: 'tenant-1',
    amount: 199.9,
    status: 'PENDING',
    expectedDate: new Date('2026-07-10'),
    paidAt: null,
    marketplaceSource: 'NUVEMSHOP',
    externalReference: 'ORDER-1',
    skuCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function buildListener(existing: ReceivableRecord | null) {
    const repository: jest.Mocked<ReceivableRecordRepository> = {
      create: jest.fn().mockResolvedValue(existingReceivable),
      findById: jest.fn(),
      findByStatus: jest.fn(),
      findByExternalReference: jest.fn().mockResolvedValue(existing),
      markPaid: jest.fn(),
      cancel: jest.fn().mockResolvedValue({ ...existingReceivable, status: 'CANCELLED' }),
    };
    const listener = new ReceivableFromOrderListener(repository);
    return { listener, repository };
  }

  describe('handleOrderPaid', () => {
    // totalAmount (bruto, o que o cliente pagou) e netAmount (líquido, o que
    // o vendedor recebe) propositalmente diferentes aqui — o teste abaixo
    // confirma que o listener usa netAmount, nunca totalAmount, ao criar o
    // ReceivableRecord (Etapa 17, normalização financeira por adapter).
    const paidEvent: OrderPaidEvent = {
      tenantId: 'tenant-1',
      orderId: 'order-1',
      channelCode: 'NUVEMSHOP',
      externalOrderId: 'ORDER-1',
      totalAmount: 220,
      netAmount: 199.9,
      paidAt: new Date('2026-07-10'),
    };

    it('cria um ReceivableRecord com o valor LÍQUIDO (netAmount), não o bruto (totalAmount)', async () => {
      const { listener, repository } = buildListener(null);

      await listener.handleOrderPaid(paidEvent);

      expect(repository.create).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        amount: 199.9,
        expectedDate: paidEvent.paidAt,
        marketplaceSource: 'NUVEMSHOP',
        externalReference: 'ORDER-1',
      });
    });

    it('é idempotente: não cria uma segunda linha se já existe ReceivableRecord para o pedido', async () => {
      const { listener, repository } = buildListener(existingReceivable);

      await listener.handleOrderPaid(paidEvent);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('não lança exceção se o repositório falhar (log-only, não derruba o listener)', async () => {
      const repository: jest.Mocked<ReceivableRecordRepository> = {
        create: jest.fn().mockRejectedValue(new Error('db down')),
        findById: jest.fn(),
        findByStatus: jest.fn(),
        findByExternalReference: jest.fn().mockResolvedValue(null),
        markPaid: jest.fn(),
        cancel: jest.fn(),
      };
      const listener = new ReceivableFromOrderListener(repository);

      await expect(listener.handleOrderPaid(paidEvent)).resolves.toBeUndefined();
    });
  });

  describe('handleOrderCancelled', () => {
    const cancelledEvent: OrderCancelledEvent = {
      tenantId: 'tenant-1',
      orderId: 'order-1',
      channelCode: 'NUVEMSHOP',
      externalOrderId: 'ORDER-1',
      cancelledAt: new Date('2026-07-11'),
    };

    it('cancela o ReceivableRecord PENDING correspondente', async () => {
      const { listener, repository } = buildListener(existingReceivable);

      await listener.handleOrderCancelled(cancelledEvent);

      expect(repository.cancel).toHaveBeenCalledWith('rec-1');
    });

    it('não faz nada se nenhum ReceivableRecord existe para o pedido', async () => {
      const { listener, repository } = buildListener(null);

      await listener.handleOrderCancelled(cancelledEvent);

      expect(repository.cancel).not.toHaveBeenCalled();
    });

    it('não cancela automaticamente um ReceivableRecord já PAID (possível estorno, ação manual)', async () => {
      const paid: ReceivableRecord = { ...existingReceivable, status: 'PAID', paidAt: new Date() };
      const { listener, repository } = buildListener(paid);

      await listener.handleOrderCancelled(cancelledEvent);

      expect(repository.cancel).not.toHaveBeenCalled();
    });

    it('é idempotente: não recancela um ReceivableRecord já CANCELLED', async () => {
      const cancelled: ReceivableRecord = { ...existingReceivable, status: 'CANCELLED' };
      const { listener, repository } = buildListener(cancelled);

      await listener.handleOrderCancelled(cancelledEvent);

      expect(repository.cancel).not.toHaveBeenCalled();
    });
  });
});
