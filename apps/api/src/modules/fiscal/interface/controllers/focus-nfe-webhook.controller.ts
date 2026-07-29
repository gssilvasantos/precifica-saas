import { Body, Controller, Post } from '@nestjs/common';
import { FiscalInvoiceService } from '../../application/fiscal-invoice.service';

// Gatilho/webhook do Focus NFe (opcional na API deles, mas evita depender
// só de consulta manual) — endereço fixo que se cadastra no painel Focus
// NFe. Sem guard de propósito: a Focus NFe não tem como enviar um JWT
// nosso, mesma justificativa do WebhooksController de Orders. `ref` no
// corpo é o único jeito de identificar QUAL nota/tenant — nunca confiar em
// nenhum outro campo do payload para decidir isso.
@Controller('fiscal/webhooks')
export class FocusNfeWebhookController {
  constructor(private readonly invoices: FiscalInvoiceService) {}

  @Post('focus-nfe')
  async receive(@Body() payload: Record<string, unknown>) {
    await this.invoices.handleFocusNfeWebhook(payload);
    return { received: true };
  }
}
