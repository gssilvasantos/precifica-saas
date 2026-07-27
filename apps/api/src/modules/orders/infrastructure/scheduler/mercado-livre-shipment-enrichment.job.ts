import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderSyncOrchestrator } from '../../application/order-sync-orchestrator.service';
import { ORDER_REPOSITORY, OrderRepository } from '../../application/ports/order-repository.port';
import { TenantContextStore } from '../../../../shared/prisma/tenant-context';
import { MercadoLivreApiClient } from '../../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../marketplace-intelligence/application/mercado-livre-connection.service';
import {
  extractShippingId,
  normalizeMercadoLivreOrder,
} from '../../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-order-normalizer';

const MERCADO_LIVRE_CHANNEL_CODE = 'MERCADO_LIVRE';

// Reestruturação do sync ML (25-26/07/2026, ver README, "Reestruturação do
// sync ML") — a METADE resumível da reestruturação (a outra metade é
// MercadoLivreOrderProvider.fetchOrders, que agora só busca/persiste, nunca
// mais enriquece inline). Este job roda em ciclos curtos e processa um
// LOTE PEQUENO E FIXO de pedidos por tenant a cada execução — nunca "todos
// os pendentes de uma vez". Isso é o que faz o enriquecimento funcionar em
// QUALQUER hospedagem, inclusive a gratuita: mesmo que o processo seja
// interrompido no meio (Render free tier hiberna por inatividade de
// requisição HTTP), o progresso de CADA pedido já processado está gravado
// no banco (Order.shippingStatusCheckedAt, ver domain/order.entity.ts) — a
// próxima execução simplesmente continua de onde parou, sem cursor em
// memória e sem repetir trabalho já feito.
//
// Mora no módulo `orders` (não em marketplace-intelligence) pelo mesmo
// motivo de MercadoLivreOrderProvider: reaproveita
// OrderSyncOrchestrator.upsertAndEmit (agora público, ver o serviço) para a
// MESMA lógica de resolução de SKU/custo e emissão de eventos de transição
// de status — nunca duplicada aqui.
@Injectable()
export class MercadoLivreShipmentEnrichmentJob {
  private readonly logger = new Logger(MercadoLivreShipmentEnrichmentJob.name);

  // ~40 pedidos por tenant a cada execução, a 1 req/s (RateLimiter do
  // MercadoLivreApiClient) ≈ 40s de chamadas de rede — bem dentro de
  // qualquer timeout de requisição/cron, inclusive no Render free tier.
  // Deliberadamente pequeno: o objetivo não é terminar rápido, é NUNCA
  // travar — se sobrar pendente, a próxima execução (5 em 5 minutos)
  // continua, sem perder o que já foi processado.
  private static readonly BATCH_SIZE = 40;

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    private readonly client: MercadoLivreApiClient,
    private readonly connection: MercadoLivreConnectionService,
    private readonly orchestrator: OrderSyncOrchestrator,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    // Cron não passa pelo TenantContextInterceptor — bypass do envelope
    // externo (ver docs/row-level-security-architecture.md, seção 3.3); o
    // loop por tenant abaixo reabre o contexto correto antes de tocar
    // qualquer dado de pedido.
    await TenantContextStore.runAsService(() => this.runInner());
  }

  private async runInner(): Promise<void> {
    const tenantIds = await this.connection.listActiveTenantIds();
    for (const tenantId of tenantIds) {
      await TenantContextStore.run(tenantId, () => this.enrichTenant(tenantId));
    }
  }

  private async enrichTenant(tenantId: string): Promise<void> {
    const pending = await this.orders.findPendingShipmentEnrichment(
      tenantId,
      MERCADO_LIVRE_CHANNEL_CODE,
      MercadoLivreShipmentEnrichmentJob.BATCH_SIZE,
    );
    if (pending.length === 0) return;

    let accessToken: string;
    try {
      accessToken = await this.connection.getValidAccessToken(tenantId);
    } catch (error) {
      // Sem token válido (conexão desativada/revogada) — nada a fazer por
      // este tenant agora; a próxima execução tenta de novo. Não é uma
      // falha do job em si (mesmo racional de MercadoLivreOrderProvider).
      this.logger.warn(
        `Tenant ${tenantId}: não foi possível obter token válido do Mercado Livre para enriquecer status de envio — pulando (${(error as Error).message}).`,
      );
      return;
    }

    this.logger.log(`Tenant ${tenantId}: enriquecendo status de envio de até ${pending.length} pedido(s) pendente(s).`);

    for (const order of pending) {
      try {
        await this.enrichOrder(tenantId, order, accessToken);
      } catch (error) {
        // Falha em UM pedido não interrompe o lote — mesmo racional de
        // OrderSyncOrchestrator.syncTenant (falha isolada, não falha do
        // processo inteiro). O pedido continua com shippingStatusCheckedAt
        // null, então será tentado de novo na próxima execução.
        this.logger.warn(
          `Tenant ${tenantId}, pedido ${order.externalOrderId}: falha ao enriquecer status de envio (${(error as Error).message}).`,
        );
      }
    }
  }

  private async enrichOrder(tenantId: string, order: { externalOrderId: string; rawPayload: unknown }, accessToken: string): Promise<void> {
    const shippingId = extractShippingId(order.rawPayload);

    if (!shippingId) {
      // Nunca vai ter envio pra consultar (payload sem referência de
      // shipping) — marca como conferido pra não ficar pra sempre na fila,
      // mas SEM inventar um status de envio que não existe: apenas
      // renormaliza o payload já guardado (fallback de sempre).
      const raw = normalizeMercadoLivreOrder(order.rawPayload);
      if (!raw) return;
      await this.orchestrator.upsertAndEmit(tenantId, MERCADO_LIVRE_CHANNEL_CODE, raw, { shippingStatusCheckedAt: new Date() });
      return;
    }

    const shipment = await this.client.fetchShipmentStatus(shippingId, accessToken);
    if (!shipment) {
      // Envio ainda não existe / API não devolveu nada aproveitável —
      // "sem informação nova", NÃO marca como conferido: fica na fila pra
      // ser tentado de novo numa próxima execução (o shipment pode
      // aparecer/atualizar a qualquer momento).
      return;
    }

    const raw = normalizeMercadoLivreOrder(order.rawPayload, shipment.status);
    if (!raw) return;

    // Só marca shippingStatusCheckedAt quando o status resultante SAIU de
    // PREPARANDO_ENVIO (ENVIADO/ENTREGUE/CANCELADO) — confirmação real e
    // definitiva, não precisa mais ser checado. Se o Mercado Livre já
    // respondeu mas o envio ainda está em preparação (ex.: "handling"/
    // "ready_to_ship"), deixamos shippingStatusCheckedAt null de propósito:
    // o pedido continua na fila e será checado de novo depois, até o envio
    // de fato progredir — do contrário ficaria preso em PREPARANDO_ENVIO
    // pra sempre depois de UMA checagem, reproduzindo o bug original que
    // esta reestruturação existe pra resolver.
    const stillPreparing = raw.status === 'PREPARANDO_ENVIO' || raw.status === 'EM_ABERTO';
    await this.orchestrator.upsertAndEmit(
      tenantId,
      MERCADO_LIVRE_CHANNEL_CODE,
      raw,
      stillPreparing ? undefined : { shippingStatusCheckedAt: new Date() },
    );
  }
}
