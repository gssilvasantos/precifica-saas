import { Body, Controller, Logger, NotFoundException, Param, Post } from '@nestjs/common';
import { OrderProviderRegistry } from '../../application/order-provider-registry.service';
import { OrderSyncOrchestrator } from '../../application/order-sync-orchestrator.service';

// Sprint 21 (Senior Integration Engineer) — endpoint público de webhook por
// CANAL: `POST /webhooks/:channel`, ex. `/webhooks/nuvemshop`,
// `/webhooks/mercado-livre`. É o endereço que cada marketplace configura no
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
// notificação do marketplace, mas nunca é lido/desserializado aqui.
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly registry: OrderProviderRegistry,
    private readonly orchestrator: OrderSyncOrchestrator,
  ) {}

  // Sem guard de propósito — o marketplace não tem como enviar um JWT
  // nosso (mesma justificativa do webhook por providerCode).
  @Post(':channel')
  async receive(@Param('channel') channel: string, @Body() _payload: unknown) {
    const providers = this.registry.findByMarketplaceCode(channel);
    if (providers.length === 0) {
      this.logger.warn(`Webhook recebido para canal desconhecido "${channel}" — nenhum provider ORDERS registrado.`);
      throw new NotFoundException(`Nenhum canal de pedidos registrado para "${channel}".`);
    }

    this.logger.log(
      `Webhook recebido para o canal ${channel} — disparando sync incremental de ${providers.length} provider(s) (payload não é lido diretamente).`,
    );
    for (const provider of providers) {
      await this.orchestrator.syncProvider(provider.code);
    }

    return { received: true, channel, providersSynced: providers.map((p) => p.code) };
  }
}
