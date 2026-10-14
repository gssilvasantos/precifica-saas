import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MarketplaceWebhookReceivedEvent, WEBHOOK_EVENTS } from '../../orders/domain/webhook-events';
import { ChannelPaymentReconciliationOrchestrator } from './channel-payment-reconciliation-orchestrator.service';

// Integração Orders(webhook) -> Financial Intelligence — mesmo padrão de
// ReceivableFromOrderListener: importa SÓ o arquivo de constantes/tipos do
// módulo de origem (orders/domain/webhook-events.ts), zero import de
// OrdersModule ou de qualquer classe de aplicação/infra de lá.
//
// Reage ao topic "payments" do Mercado Livre (o único tópico de pagamento
// habilitado hoje, ver DevCenter do app — "tiquei tudo" cobre outros
// tópicos sem handler ainda, este é o primeiro). Um topic diferente, ou
// ausente, é ignorado silenciosamente — este listener nunca decide o que
// outro módulo deveria fazer com um tópico que não é o dele.
@Injectable()
export class PaymentWebhookListener {
  private readonly logger = new Logger(PaymentWebhookListener.name);

  constructor(private readonly orchestrator: ChannelPaymentReconciliationOrchestrator) {}

  @OnEvent(WEBHOOK_EVENTS.RECEIVED)
  async handleWebhookReceived(payload: MarketplaceWebhookReceivedEvent): Promise<void> {
    if (payload.topic !== 'payments') return;

    try {
      await this.orchestrator.syncChannel(payload.channel);
    } catch (error) {
      // Mesmo racional de ReceivableFromOrderListener: erro de handler de
      // evento nunca deve derrubar o processamento do webhook em si (a
      // resposta HTTP do WebhooksController já foi enviada antes deste
      // listener rodar) — só loga. Falha de integração em si já é
      // alertada dentro do orchestrator (ChannelPaymentReconciliationOrchestrator).
      this.logger.error(
        `Falha ao processar webhook de pagamento do canal ${payload.channel}: ${(error as Error).message}`,
      );
    }
  }
}
