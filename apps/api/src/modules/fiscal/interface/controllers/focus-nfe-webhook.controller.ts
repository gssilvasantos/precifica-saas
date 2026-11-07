import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FiscalInvoiceService } from '../../application/fiscal-invoice.service';
import { WebhookSecretGuard } from '../../../../shared/security/webhook-secret.guard';

// Gatilho/webhook do Focus NFe (opcional na API deles, mas evita depender
// só de consulta manual) — endereço fixo que se cadastra no painel Focus
// NFe. Sem JwtAuthGuard de propósito: a Focus NFe não tem como enviar um
// JWT nosso, mesma justificativa do WebhooksController de Orders. `ref` no
// corpo é o único jeito de identificar QUAL nota/tenant — nunca confiar em
// nenhum outro campo do payload para decidir isso.
//
// A partir de 20/10/2026 (achado de auditoria de segurança) exige
// `?secret=...` na query string (WebhookSecretGuard — ver
// docs/decisions/0006-webhook-shared-secret.md): a Focus NFe não assina a
// notificação, então sem isso qualquer um que descobrisse/adivinhasse um
// `ref` válido conseguia forjar uma atualização de status de nota fiscal.
@Controller('fiscal/webhooks')
export class FocusNfeWebhookController {
  constructor(private readonly invoices: FiscalInvoiceService) {}

  @UseGuards(WebhookSecretGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('focus-nfe')
  async receive(@Body() payload: Record<string, unknown>) {
    await this.invoices.handleFocusNfeWebhook(payload);
    return { received: true };
  }
}
