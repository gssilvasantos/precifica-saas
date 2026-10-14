import { PaymentWebhookListener } from './payment-webhook.listener';
import { ChannelPaymentReconciliationOrchestrator } from './channel-payment-reconciliation-orchestrator.service';

describe('PaymentWebhookListener', () => {
  function buildListener() {
    const orchestrator = { syncChannel: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<ChannelPaymentReconciliationOrchestrator>;
    const listener = new PaymentWebhookListener(orchestrator);
    return { listener, orchestrator };
  }

  it('topic "payments": dispara a conciliação do canal recebido', async () => {
    const { listener, orchestrator } = buildListener();

    await listener.handleWebhookReceived({ channel: 'MERCADO_LIVRE', topic: 'payments' });

    expect(orchestrator.syncChannel).toHaveBeenCalledWith('MERCADO_LIVRE');
  });

  it('topic diferente de "payments": ignora, não dispara nada', async () => {
    const { listener, orchestrator } = buildListener();

    await listener.handleWebhookReceived({ channel: 'MERCADO_LIVRE', topic: 'orders_v2' });

    expect(orchestrator.syncChannel).not.toHaveBeenCalled();
  });

  it('topic ausente: ignora, não dispara nada, não lança', async () => {
    const { listener, orchestrator } = buildListener();

    await listener.handleWebhookReceived({ channel: 'NUVEMSHOP' });

    expect(orchestrator.syncChannel).not.toHaveBeenCalled();
  });

  it('falha do orquestrador: loga e não propaga a exceção', async () => {
    const orchestrator = {
      syncChannel: jest.fn().mockRejectedValue(new Error('falhou')),
    } as unknown as jest.Mocked<ChannelPaymentReconciliationOrchestrator>;
    const listener = new PaymentWebhookListener(orchestrator);

    await expect(listener.handleWebhookReceived({ channel: 'MERCADO_LIVRE', topic: 'payments' })).resolves.toBeUndefined();
  });
});
