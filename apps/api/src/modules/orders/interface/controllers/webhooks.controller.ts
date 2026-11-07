import { Body, Controller, Logger, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Throttle } from '@nestjs/throttler';
import { OrderProviderRegistry } from '../../application/order-provider-registry.service';
import { OrderSyncOrchestrator } from '../../application/order-sync-orchestrator.service';
import { WEBHOOK_EVENTS } from '../../domain/webhook-events';
import { WebhookSecretGuard } from '../../../../shared/security/webhook-secret.guard';

// Sprint 21 (Senior Integration Engineer) — endpoint público de webhook por
// CANAL: `POST /webhooks/:channel`, ex. `/webhooks/nuvemshop`,
// `/webhooks/mercado_livre`. É o endereço que cada marketplace configura no
// próprio painel de desenvolvedor — mais estável e legível que expor o
// `provider.code` interno (`NUVEMSHOP_ORDERS`), e agnóstico de quantos
// providers um canal tenha registrado (hoje 1:1, mas nada impede um canal
// futuro ter mais de um provider ORDERS-capable).
//
// Esta é uma FACHADA sobre o webhook já existente em
// OrdersSyncController (`POST /orders/providers/:providerCode/webhook`,
// Etapa 16) — mesma lógica de "nudge" (nunca lê o payload do marketplace
// para aplicar dado direto, só usa a chegada da notificação para disparar
// o MESMO pipeline incremental do scheduler), só que endereçada por
// marketplaceCode em vez de providerCode. Nenhuma duplicação de lógica de
// sync: ambos delegam para OrderSyncOrchestrator.syncProvider().
//
// AVISO DE HONESTIDADE (mesmo gap documentado em OrdersSyncController): sem
// validação de assinatura/segredo do webhook (específica por canal, não
// configurada ainda) — o payload do corpo é recebido só para não rejeitar a
// notificação do marketplace, mas nunca é desserializado para aplicar dado
// direto aqui.
//
// Topic-aware (13/10/2026) — o Mercado Livre registra UMA única URL de
// notificação para TODOS os tópicos habilitados no app (Orders, Payments,
// Messages...), então este endpoint agora lê o campo `topic` do corpo (ex.:
// "orders_v2", "payments") só para ROTEAR, nunca para aplicar dado: o sync
// de pedidos abaixo continua disparando para QUALQUER webhook de um canal
// registrado em ORDER_CAPABLE_PROVIDERS, exatamente como antes (nenhuma
// regressão no caminho já em produção). Além disso, emite
// WEBHOOK_EVENTS.RECEIVED com { channel, topic } — zero-import, mesmo
// padrão de ORDER_EVENTS — para que outros módulos (Financial Intelligence,
// conciliação de pagamento) reajam ao tópico sem este controller conhecer
// quem está ouvindo.
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly registry: OrderProviderRegistry,
    private readonly orchestrator: OrderSyncOrchestrator,
    private readonly events: EventEmitter2,
  ) {}

  // Sem JwtAuthGuard de propósito — o marketplace não tem como enviar um
  // JWT nosso (mesma justificativa de sempre). Mas a partir de 20/10/2026
  // (achado de auditoria de segurança) exige `?secret=...` na query string
  // (WebhookSecretGuard — ver docs/decisions/0006-webhook-shared-secret.md):
  // sem isso, qualquer um que descobrisse o nome do canal conseguia disparar
  // `orchestrator.syncProvider()` de verdade. Throttle extra aqui (mais
  // restrito que o global de app.module.ts) porque este endpoint dispara
  // trabalho real contra APIs de terceiro a cada chamada — mesmo com o
  // segredo, limita o estrago de um segredo vazado.
  @UseGuards(WebhookSecretGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post(':channel')
  async receive(@Param('channel') channel: string, @Body() payload: unknown) {
    const providers = this.registry.findByMarketplaceCode(channel);
    if (providers.length === 0) {
      this.logger.warn(`Webhook recebido para canal desconhecido "${channel}" — nenhum provider ORDERS registrado.`);
      throw new NotFoundException(`Nenhum canal de pedidos registrado para "${channel}".`);
    }

    // Leitura mínima e tolerante: só o campo `topic` (string), só para
    // roteamento do evento abaixo — nunca usado para decidir o sync de
    // pedidos nem para aplicar qualquer outro dado do corpo.
    const topic = this.extractTopic(payload);

    this.logger.log(
      `Webhook recebido para o canal ${channel}${topic ? ` (topic=${topic})` : ''} — disparando sync incremental de ${providers.length} provider(s) (payload não é desserializado para aplicar dado).`,
    );
    for (const provider of providers) {
      await this.orchestrator.syncProvider(provider.code);
    }

    const normalizedChannel = channel.toUpperCase();
    this.events.emit(WEBHOOK_EVENTS.RECEIVED, { channel: normalizedChannel, topic });

    return { received: true, channel, topic, providersSynced: providers.map((p) => p.code) };
  }

  private extractTopic(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const topic = (payload as Record<string, unknown>).topic;
    return typeof topic === 'string' ? topic : undefined;
  }
}
