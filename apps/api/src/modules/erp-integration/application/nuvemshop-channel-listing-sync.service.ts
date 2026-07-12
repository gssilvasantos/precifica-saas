import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  NUVEMSHOP_CONNECTION_REPOSITORY,
  NuvemshopConnectionRepository,
} from './ports/nuvemshop-connection-repository.port';
import { CHANNEL_LISTING_REPOSITORY, ChannelListingRepository } from './ports/channel-listing-repository.port';
import {
  PROVIDER_SYNC_LOG_REPOSITORY,
  ProviderSyncLogRepository,
} from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import {
  PROVIDER_HEALTH_REPOSITORY,
  ProviderHealthRepository,
} from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { NuvemshopApiClient } from '../infrastructure/nuvemshop/nuvemshop-api.client';

export const CHANNEL_LISTINGS_PROVIDER_CODE = 'NUVEMSHOP_CHANNEL_LISTINGS';
const CHANNEL_CODE = 'NUVEMSHOP';

// Vínculo por SKU (requisito 4 do pedido): a Nuvemshop é a única fonte deste
// módulo cujo objetivo é popular ChannelListing, porque é a única, por
// enquanto, cujo "SKU da variante" o Precifica já sabe ler via API pública.
// Vincular ML/Shopee é o mesmo desenho, um provider a mais, quando os
// adaptadores desses canais existirem — não muda esta classe.
@Injectable()
export class NuvemshopChannelListingSyncService {
  private readonly logger = new Logger(NuvemshopChannelListingSyncService.name);

  constructor(
    @Inject(NUVEMSHOP_CONNECTION_REPOSITORY) private readonly connections: NuvemshopConnectionRepository,
    @Inject(CHANNEL_LISTING_REPOSITORY) private readonly listings: ChannelListingRepository,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
    private readonly credentials: CredentialEncryptionService,
    private readonly client: NuvemshopApiClient,
  ) {}

  async syncAllTenants(intervalMinutes: number): Promise<void> {
    const activeConnections = await this.connections.findAllActive();
    const now = Date.now();
    const due = activeConnections.filter(
      (c) => !c.lastSyncedAt || now - c.lastSyncedAt.getTime() >= intervalMinutes * 60_000,
    );
    for (const connection of due) {
      await this.syncTenant(connection.tenantId);
    }
  }

  async syncTenant(tenantId: string): Promise<void> {
    const correlationId = randomUUID();
    const logId = await this.syncLogs.start(CHANNEL_LISTINGS_PROVIDER_CODE, correlationId);
    let candidatesFound = 0;
    let candidatesApplied = 0;

    try {
      const record = await this.connections.findByTenant(tenantId);
      if (!record || !record.isActive) throw new Error('Conexão com a Nuvemshop inativa ou não encontrada.');
      const accessToken = this.credentials.decrypt(record.accessTokenEnc);

      const products = await this.client.fetchAllProducts(record.storeId, accessToken);
      candidatesFound = products.length;
      await this.health.recordSuccess(CHANNEL_LISTINGS_PROVIDER_CODE);

      for (const product of products) {
        for (const variant of product.variants) {
          try {
            await this.listings.upsert({
              tenantId,
              skuCode: variant.sku,
              channelCode: CHANNEL_CODE,
              externalId: product.id,
              currentPrice: Number(variant.price) || null,
              url: product.permalink ?? null,
            });
            candidatesApplied++;
          } catch (error) {
            this.logger.warn(`Falha ao vincular SKU ${variant.sku} (produto Nuvemshop ${product.id}): ${(error as Error).message}`);
          }
        }
      }

      await this.connections.markSynced(tenantId, new Date());
      await this.syncLogs.finish(logId, { status: 'SUCCESS', candidatesFound, candidatesApplied });
    } catch (error) {
      await this.health.recordFailure(CHANNEL_LISTINGS_PROVIDER_CODE, (error as Error).message);
      await this.syncLogs.finish(logId, {
        status: 'FAILED',
        candidatesFound,
        candidatesApplied,
        errorDetails: (error as Error).message,
      });
      this.logger.error(`Sync de listings da Nuvemshop falhou para o tenant ${tenantId}: ${(error as Error).message}`);
    }
  }
}
