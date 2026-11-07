import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FocusNfeWebhookController } from './focus-nfe-webhook.controller';
import { FiscalInvoiceService } from '../../application/fiscal-invoice.service';
import { WebhookSecretGuard } from '../../../../shared/security/webhook-secret.guard';

describe('FocusNfeWebhookController', () => {
  function buildController() {
    const invoices = { handleFocusNfeWebhook: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<FiscalInvoiceService>;
    const controller = new FocusNfeWebhookController(invoices);
    return { controller, invoices };
  }

  it('delega o payload inteiro para FiscalInvoiceService.handleFocusNfeWebhook e confirma o recebimento', async () => {
    const { controller, invoices } = buildController();
    const payload = { ref: 'ref-123', status: 'autorizado' };

    const result = await controller.receive(payload);

    expect(invoices.handleFocusNfeWebhook).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ received: true });
  });

  // Regressão (20/10/2026): mesma razão do teste equivalente em
  // webhooks.controller.spec.ts — o guard protege via metadata do Nest, uma
  // chamada direta ao método não o exercita.
  it('a rota receive() está protegida por WebhookSecretGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, FocusNfeWebhookController.prototype.receive);
    expect(guards).toContain(WebhookSecretGuard);
  });
});
