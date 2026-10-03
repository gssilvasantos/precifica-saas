import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ShopeeConnectionService } from './shopee-connection.service';
import { ShopeeApiClient } from '../infrastructure/providers/shopee/shopee-api-client';
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

export const SHOPEE_CHANNEL_LISTINGS_PROVIDER_CODE = 'SHOPEE_CHANNEL_LISTINGS';
const CHANNEL_CODE = 'SHOPEE';

// Fecha o gap diagnosticado em 03/10/2026 (a pedido do Gui: "por que o
// Kyneti não funciona com a Shopee se eles estão conectados") — a conexão
// (ShopeeConnectionService) sempre esteve ativa e renovando token
// normalmente; o que nunca existiu foi ISTO, o serviço que lê os anúncios
// JÁ publicados pelo vendedor na Shopee e popula ChannelListing por SKU —
// mesmo papel de MercadoLivreChannelListingSyncService (ver aquele arquivo
// para o racional completo de por que isto nunca aplica preço em lugar
// nenhum, só alimenta o motor de pricing/concorrência já existente com dado
// real).
//
// Diferente do Mercado Livre, aqui NÃO há reconciliação automática com o
// radar de concorrência (CHANNEL_LISTING_EVENTS) — mesmo alcance que a
// Nuvemshop já tem hoje (ChannelListing populado, radar de catálogo é uma
// decisão em aberto específica de cada canal, não implícita só por existir
// o sync). Se/quando o Gui quiser o radar de concorrência também pra
// Shopee, é um pedido novo, não uma correção deste gap.
@Injectable()
export class ShopeeChannelListingSyncService {
  private readonly logger = new Logger(ShopeeChannelListingSyncService.name);

  constructor(
    private readonly connections: ShopeeConnectionService,
    @Inject(CHANNEL_LISTING_WRITER) private readonly listings: ChannelListingWriter,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
    private readonly client: ShopeeApiClient,
  ) {}

  async syncAllTenants(): Promise<void> {
    const tenantIds = await this.connections.listActiveTenantIds();
    for (const tenantId of tenantIds) {
      await this.syncTenant(tenantId);
    }
  }

  async syncTenant(tenantId: string): Promise<{ success: boolean; error?: string }> {
    const correlationId = randomUUID();
    const logId = await this.syncLogs.start(SHOPEE_CHANNEL_LISTINGS_PROVIDER_CODE, correlationId);
    let candidatesFound = 0;
    let candidatesApplied = 0;

    try {
      const shopId = await this.connections.getShopId(tenantId);
      if (!shopId) throw new Error('Conexão com a Shopee inativa ou sem shopId para este tenant.');
      const accessToken = await this.connections.getValidAccessToken(tenantId);
      const partnerId = this.requireEnv('SHOPEE_PARTNER_ID');
      const partnerKey = this.requireEnv('SHOPEE_PARTNER_KEY');

      const itemIds = await this.client.fetchItemList(partnerId, partnerKey, shopId, accessToken);
      const items = await this.client.fetchItemBaseInfo(partnerId, partnerKey, shopId, accessToken, itemIds);
      candidatesFound = items.length;
      await this.health.recordSuccess(SHOPEE_CHANNEL_LISTINGS_PROVIDER_CODE);

      for (const item of items) {
        if (!item.skuCode) {
          // Mesma filosofia de MercadoLivreChannelListingSyncService: loga o
          // título pra permitir vínculo manual depois, nunca tenta adivinhar
          // o SKU por nome (risco real de falso positivo).
          this.logger.warn(
            `Anúncio Shopee ${item.id} (tenant ${tenantId}) sem SKU vinculado — ignorado na sincronização de ChannelListing. Título: "${item.title ?? 'desconhecido'}".`,
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
            // A Shopee não devolve um permalink em get_item_base_info (diferente
            // do Mercado Livre) — URL pública construída a partir do padrão
            // conhecido da própria vitrine da Shopee (shopId + itemId).
            // AVISO DE HONESTIDADE: nunca confirmado contra um link real
            // deste shopId específico; se o padrão da Shopee mudar ou vier
            // errado para algum item, corrige-se aqui, sem afetar o vínculo
            // de SKU (que é o dado que importa pro pricing).
            url: `https://shopee.com.br/product/${shopId}/${item.id}`,
          });
          candidatesApplied++;
        } catch (error) {
          this.logger.warn(`Falha ao vincular SKU ${item.skuCode} (anúncio Shopee ${item.id}, tenant ${tenantId}): ${(error as Error).message}`);
        }
      }

      await this.syncLogs.finish(logId, { status: 'SUCCESS', candidatesFound, candidatesApplied });
      return { success: true };
    } catch (error) {
      const message = (error as Error).message;
      await this.health.recordFailure(SHOPEE_CHANNEL_LISTINGS_PROVIDER_CODE, message);
      await this.syncLogs.finish(logId, {
        status: 'FAILED',
        candidatesFound,
        candidatesApplied,
        errorDetails: message,
      });
      this.logger.error(`Sync de ChannelListing da Shopee falhou para o tenant ${tenantId}: ${message}`);
      return { success: false, error: message };
    }
  }

  // Mesmo racional defensivo duplicado de ShopeeConnectionService/ShopeeListingProvider
  // — cada classe lê sua própria env var, sem helper compartilhado (ver aviso
  // em ShopeeConnectionService.requireEnv sobre .trim() contra espaço oculto).
  private requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new InternalServerErrorException(
        `Variável de ambiente ${name} não configurada — a integração da Shopee não pode funcionar sem ela.`,
      );
    }
    return value;
  }
}
