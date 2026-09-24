import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { MercadoLivreConnectionService } from './mercado-livre-connection.service';
import { MercadoLivreApiClient } from '../infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { CHANNEL_LISTING_WRITER } from '../../../shared/contracts/tokens';
import { ChannelListingWriter } from '../../../shared/contracts/channel-listing-reader.port';
import {
  PROVIDER_SYNC_LOG_REPOSITORY,
  ProviderSyncLogRepository,
} from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import {
  PROVIDER_HEALTH_REPOSITORY,
  ProviderHealthRepository,
} from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { CHANNEL_LISTING_EVENTS, SyncedChannelListing } from '../domain/channel-listing-events';

export const MERCADO_LIVRE_CHANNEL_LISTINGS_PROVIDER_CODE = 'MERCADO_LIVRE_CHANNEL_LISTINGS';
const CHANNEL_CODE = 'MERCADO_LIVRE';

// Vínculo por SKU (mesmo requisito, mesmo desenho de
// NuvemshopChannelListingSyncService — ver aquele arquivo para o racional
// original) — a diferença aqui é a origem do dado: dois endpoints do Mercado
// Livre em sequência (fetchSellerItemIds -> fetchItemsDetails, ambos em
// mercado-livre-api.client.ts), porque a API do canal não devolve o SKU do
// vendedor na mesma chamada que lista os ids dos anúncios.
//
// Ativação do radar de catálogo para tenants reais (18/09/2026, "Só ligar o
// radar" — ver ADR pendente/docs/pricing-intelligence-architecture.md): este
// serviço POPULA ChannelListing e emite CHANNEL_LISTING_EVENTS.MERCADO_LIVRE_SYNCED,
// mas NUNCA aplica preço em lugar nenhum — nenhum canal tem
// PriceUpdateCapableProvider registrado hoje (ver PriceUpdateDispatcherService),
// então essa capacidade nem existiria aqui. Popular ChannelListing +
// MonitoredCompetitorListing só faz o motor de pricing JÁ EXISTENTE
// (PricingDecisionService) enxergar concorrência real e RECOMENDAR preço —
// aplicar continua manual (POST /pricing-intelligence/apply/:skuCode) até
// autoRepricingEnabled ser ligado por produto, e mesmo esse caminho não
// escreve de volta no Mercado Livre.
@Injectable()
export class MercadoLivreChannelListingSyncService {
  private readonly logger = new Logger(MercadoLivreChannelListingSyncService.name);

  constructor(
    private readonly connections: MercadoLivreConnectionService,
    @Inject(CHANNEL_LISTING_WRITER) private readonly listings: ChannelListingWriter,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
    private readonly client: MercadoLivreApiClient,
    private readonly events: EventEmitter2,
  ) {}

  // SIMPLIFICAÇÃO CONSCIENTE (18/09/2026): diferente de
  // NuvemshopChannelListingSyncService.syncAllTenants, não há filtro de
  // "tenant já em dia" aqui — MercadoLivreConnection não tem um
  // lastSyncedAt (só lastRefreshedAt, do token OAuth2, e expiresAt).
  // Adicionar essa coluna seria migration + RLS/grant novos para um ganho
  // hoje irrelevante: o volume real de tenants com Mercado Livre conectado
  // é baixo (poucas unidades), o scheduler já roda no máximo a cada 30 min
  // (ver mercado-livre-channel-listing-sync-scheduler.job.ts), e toda
  // chamada de rede passa pelo RateLimiter/withRetry do próprio
  // MercadoLivreApiClient — o risco aceito é sincronizar tenants que já
  // estavam em dia, não sobrecarregar a API do canal. Se o número de tenants
  // crescer a ponto disso importar, o hardening é o mesmo padrão já usado
  // pela Nuvemshop (uma coluna + um filtro), não uma mudança de desenho.
  async syncAllTenants(): Promise<void> {
    const tenantIds = await this.connections.listActiveTenantIds();
    for (const tenantId of tenantIds) {
      await this.syncTenant(tenantId);
    }
  }

  // Mesmo contrato de retorno explícito de NuvemshopChannelListingSyncService.syncTenant
  // (ver aquele arquivo) — quem chama sabe se falhou, sem precisar inspecionar log.
  async syncTenant(tenantId: string): Promise<{ success: boolean; error?: string }> {
    const correlationId = randomUUID();
    const logId = await this.syncLogs.start(MERCADO_LIVRE_CHANNEL_LISTINGS_PROVIDER_CODE, correlationId);
    let candidatesFound = 0;
    let candidatesApplied = 0;

    try {
      const sellerId = await this.connections.getSellerId(tenantId);
      if (!sellerId) throw new Error('Conexão com o Mercado Livre inativa ou sem sellerId para este tenant.');
      const accessToken = await this.connections.getValidAccessToken(tenantId);

      let itemIds = await this.client.fetchSellerItemIds(sellerId, accessToken);

      // Fallback (19/09/2026, ver comentário em fetchOrderSellerIdSample no
      // client): 0 anúncios com o sellerId vindo do token OAuth2 pode
      // significar que esse ID não é o dono real dos anúncios (conta
      // operadora/colaboradora). Só entra aqui quando a busca normal já deu
      // 0 — nunca piora o resultado (na pior hipótese, o sellerId
      // alternativo também devolve 0, igual ao comportamento anterior).
      if (itemIds.length === 0) {
        const alternateSellerId = await this.client.fetchOrderSellerIdSample(sellerId, accessToken);
        if (alternateSellerId && alternateSellerId !== sellerId) {
          this.logger.warn(
            `Tenant ${tenantId}: /users/${sellerId}/items/search devolveu 0 anúncios — tentando sellerId alternativo ${alternateSellerId} (extraído de um pedido real já sincronizado deste tenant).`,
          );
          itemIds = await this.client.fetchSellerItemIds(alternateSellerId, accessToken);
        }
      }

      const items = await this.client.fetchItemsDetails(itemIds, accessToken);
      candidatesFound = items.length;
      await this.health.recordSuccess(MERCADO_LIVRE_CHANNEL_LISTINGS_PROVIDER_CODE);

      const synced: SyncedChannelListing[] = [];
      for (const item of items) {
        if (!item.skuCode) {
          // Anúncio sem SKU cadastrado no Mercado Livre não tem como ser
          // vinculado a um Product do Kyneti por SKU — mesma filosofia de
          // "descarta o item, não o lote" do resto do client (ver
          // resolveSellerSku em mercado-livre-api.client.ts).
          //
          // Diagnóstico (24/09/2026, a pedido do Gui): loga também o título
          // do anúncio — só pra permitir um humano cruzar manualmente com o
          // nome do produto no catálogo (Kyneti/Olist) e decidir o SKU
          // certo pra cadastrar diretamente no Mercado Livre. Nunca usado
          // pra vincular automaticamente — combinar texto de título com
          // nome de produto tem risco real de falso positivo (dois produtos
          // parecidos, cor/tamanho diferente), e vincular errado contaminaria
          // preço/concorrência desse SKU.
          this.logger.warn(
            `Anúncio Mercado Livre ${item.id} (tenant ${tenantId}) sem SKU vinculado — ignorado na sincronização de ChannelListing. Título: "${item.title ?? 'desconhecido'}".`,
          );
          continue;
        }
        try {
          await this.listings.upsert({
            tenantId,
            skuCode: item.skuCode,
            channelCode: CHANNEL_CODE,
            externalId: item.id,
            currentPrice: item.price,
            url: item.permalink,
          });
          synced.push({ skuCode: item.skuCode, externalId: item.id });
          candidatesApplied++;
        } catch (error) {
          this.logger.warn(`Falha ao vincular SKU ${item.skuCode} (anúncio Mercado Livre ${item.id}, tenant ${tenantId}): ${(error as Error).message}`);
        }
      }

      await this.syncLogs.finish(logId, { status: 'SUCCESS', candidatesFound, candidatesApplied });

      // Só emite quando há algo para reconciliar — evita acordar o listener
      // do Competition Intelligence num tenant sem nenhum anúncio vinculável.
      if (synced.length > 0) {
        this.events.emit(CHANNEL_LISTING_EVENTS.MERCADO_LIVRE_SYNCED, { tenantId, listings: synced });
      }

      return { success: true };
    } catch (error) {
      const message = (error as Error).message;
      await this.health.recordFailure(MERCADO_LIVRE_CHANNEL_LISTINGS_PROVIDER_CODE, message);
      await this.syncLogs.finish(logId, {
        status: 'FAILED',
        candidatesFound,
        candidatesApplied,
        errorDetails: message,
      });
      this.logger.error(`Sync de ChannelListing do Mercado Livre falhou para o tenant ${tenantId}: ${message}`);
      return { success: false, error: message };
    }
  }
}
