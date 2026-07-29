import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_EVENTS, OrderPaidEvent } from '../../orders/domain/order-events';
import { FISCAL_SETTINGS_REPOSITORY, FiscalSettingsRepository } from './ports/fiscal-settings-repository.port';
import { ALERT_SERVICE } from '../../../shared/observability/ports/alert-service.port';
import type { AlertService } from '../../../shared/observability/ports/alert-service.port';

// Gatilho de auto-emissão (FiscalSettings.autoEmitOnApproval) — decisão do
// usuário (28/07/2026): a emissão deve ter tanto um botão manual quanto uma
// opção de automatizar ao aprovar o pedido. ORDER_EVENTS.PAID é o evento
// mais próximo de "aprovado" no vocabulário desta base: dispara na
// transição de EM_ABERTO para qualquer estágio além dele (ver
// domain/order-transition-events.ts) — mesmo evento que
// ReceivableFromOrderListener já consome para criar a conta a receber.
//
// GAP CONHECIDO (ver docs/fiscal-nfe-architecture.md): Order não guarda
// nome/endereço estruturado do comprador — nenhum canal normaliza isso
// ainda, só buyerTaxId (CPF/CNPJ). Sem esses dados, o Focus NFe rejeita a
// emissão (campo obrigatório). Por isso este listener HOJE só registra um
// alerta operacional pedindo emissão manual, em vez de silenciosamente
// falhar ou inventar um endereço. No dia em que Order ganhar esses campos,
// este listener passa a montar o destinatário de verdade e chamar
// FiscalInvoiceService.emit — sem precisar mexer no restante do fluxo.
@Injectable()
export class OrderApprovedAutoEmitListener {
  constructor(
    @Inject(FISCAL_SETTINGS_REPOSITORY) private readonly settings: FiscalSettingsRepository,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  @OnEvent(ORDER_EVENTS.PAID)
  async handle(event: OrderPaidEvent): Promise<void> {
    const settings = await this.settings.findByTenant(event.tenantId);
    if (!settings?.autoEmitOnApproval) return;

    this.alerts.emitAlert({
      source: 'OrderApprovedAutoEmitListener',
      severity: 'WARNING',
      message:
        `Pedido ${event.externalOrderId} aprovado com auto-emissão de NF-e ativada, mas o Kyneti ainda não tem ` +
        `nome/endereço estruturado do comprador para montar o destinatário automaticamente — emita manualmente ` +
        `via POST /fiscal/invoices/orders/${event.orderId}/emit informando o destinatário.`,
      context: { tenantId: event.tenantId, orderId: event.orderId, channelCode: event.channelCode },
    });
  }
}
