import { AuditSeederService } from './audit-seeder.service';
import { OrderRepository, OrderUpsertResult } from './ports/order-repository.port';
import { Order } from '../domain/order.entity';

function buildUpsertResult(): OrderUpsertResult {
  return { order: {} as Order, isNew: true, previousStatus: null };
}

describe('AuditSeederService', () => {
  function buildService() {
    const orderRepository: jest.Mocked<OrderRepository> = {
      upsert: jest.fn().mockResolvedValue(buildUpsertResult()),
      findById: jest.fn(),
      findWithFilters: jest.fn(),
      countByStatus: jest.fn(),
      findAllForPeriod: jest.fn(),
      deleteDemoOrders: jest.fn().mockResolvedValue(10),
      findItemsByOrderIds: jest.fn().mockResolvedValue([]),
    };
    const service = new AuditSeederService(orderRepository);
    return { service, orderRepository };
  }

  describe('seed', () => {
    it('injeta exatamente 10 pedidos, todos com isDemo=true e externalOrderId fixo (DEMO-AUDIT-001..010)', async () => {
      const { service, orderRepository } = buildService();

      const result = await service.seed('tenant-1');

      expect(result.seeded).toBe(10);
      expect(orderRepository.upsert).toHaveBeenCalledTimes(10);
      expect(result.externalOrderIds).toEqual([
        'DEMO-AUDIT-001',
        'DEMO-AUDIT-002',
        'DEMO-AUDIT-003',
        'DEMO-AUDIT-004',
        'DEMO-AUDIT-005',
        'DEMO-AUDIT-006',
        'DEMO-AUDIT-007',
        'DEMO-AUDIT-008',
        'DEMO-AUDIT-009',
        'DEMO-AUDIT-010',
      ]);
      for (const call of orderRepository.upsert.mock.calls) {
        expect(call[0]).toMatchObject({ tenantId: 'tenant-1', isDemo: true });
      }
    });

    it('cobre os cenários pedidos: ao menos uma margem positiva, uma negativa, um frete alto e uma taxa alta', async () => {
      const { service, orderRepository } = buildService();

      await service.seed('tenant-1');

      const calls = orderRepository.upsert.mock.calls.map((call) => call[0]);

      // Margem positiva clara: revenue líquida bem acima do custo total dos itens.
      const positivo = calls.find((c) => c.externalOrderId === 'DEMO-AUDIT-001')!;
      const custoPositivo = positivo.items.reduce((sum, i) => sum + (i.costPrice ?? 0) * i.quantity, 0);
      expect(positivo.netAmount - custoPositivo).toBeGreaterThan(0);

      // Margem negativa clara: custo total dos itens excede o valor líquido.
      const negativo = calls.find((c) => c.externalOrderId === 'DEMO-AUDIT-003')!;
      const custoNegativo = negativo.items.reduce((sum, i) => sum + (i.costPrice ?? 0) * i.quantity, 0);
      expect(negativo.netAmount - custoNegativo).toBeLessThan(0);

      // Frete alto: shippingAmount é a maior fatia do totalAmount.
      const freteAlto = calls.find((c) => c.externalOrderId === 'DEMO-AUDIT-004')!;
      expect(freteAlto.shippingAmount).toBeGreaterThanOrEqual(freteAlto.subtotalAmount / 2);

      // Taxa alta/variada: feeAmount expressivo relativo ao totalAmount.
      const taxaAlta = calls.find((c) => c.externalOrderId === 'DEMO-AUDIT-005')!;
      expect(taxaAlta.feeAmount / taxaAlta.totalAmount).toBeGreaterThan(0.2);
    });

    it('Regra de Ouro: inclui um pedido CANCELADO e um item de custo desconhecido, nunca fabricando dado', async () => {
      const { service, orderRepository } = buildService();

      await service.seed('tenant-1');

      const calls = orderRepository.upsert.mock.calls.map((call) => call[0]);
      const cancelado = calls.find((c) => c.status === 'CANCELADO');
      expect(cancelado).toBeDefined();
      expect(cancelado!.cancelledAt).toBeInstanceOf(Date);

      const custoDesconhecido = calls.find((c) => c.externalOrderId === 'DEMO-AUDIT-008')!;
      expect(custoDesconhecido.items[0].costPrice).toBeUndefined();
      expect(custoDesconhecido.items[0].skuCode).toBeUndefined();
    });

    it('inclui um pedido de taxa zero suspeita fora da Nuvemshop (heurística de suspeita do DRE)', async () => {
      const { service, orderRepository } = buildService();

      await service.seed('tenant-1');

      const calls = orderRepository.upsert.mock.calls.map((call) => call[0]);
      const taxaZeroSuspeita = calls.find((c) => c.externalOrderId === 'DEMO-AUDIT-009')!;
      expect(taxaZeroSuspeita.channelCode).not.toBe('NUVEMSHOP');
      expect(taxaZeroSuspeita.feeAmount).toBe(0);
    });

    it('rodar seed duas vezes continua chamando upsert (idempotente pela chave de negócio do repositório) sem gerar externalOrderIds novos', async () => {
      const { service, orderRepository } = buildService();

      await service.seed('tenant-1');
      await service.seed('tenant-1');

      expect(orderRepository.upsert).toHaveBeenCalledTimes(20);
      const allIds = orderRepository.upsert.mock.calls.map((call) => call[0].externalOrderId);
      expect(new Set(allIds).size).toBe(10);
    });
  });

  describe('clear', () => {
    it('delega ao repositório e devolve a contagem de remoção', async () => {
      const { service, orderRepository } = buildService();

      const result = await service.clear('tenant-1');

      expect(orderRepository.deleteDemoOrders).toHaveBeenCalledWith('tenant-1');
      expect(result.removed).toBe(10);
    });
  });

  describe('getStatus', () => {
    it('soma os contadores por status em DEMO para o total de pedidos de demonstração', async () => {
      const { service, orderRepository } = buildService();
      orderRepository.countByStatus.mockResolvedValue({
        EM_ABERTO: 1,
        PREPARANDO_ENVIO: 1,
        FATURADO: 1,
        ENVIADO: 1,
        ENTREGUE: 5,
        CANCELADO: 1,
      });

      const status = await service.getStatus('tenant-1');

      expect(orderRepository.countByStatus).toHaveBeenCalledWith('tenant-1', 'DEMO');
      expect(status.totalDemoOrders).toBe(10);
    });
  });
});
