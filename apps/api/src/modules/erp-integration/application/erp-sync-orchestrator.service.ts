import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  OLIST_CONNECTION_REPOSITORY,
  OlistConnectionRepository,
} from './ports/olist-connection-repository.port';
import {
  ERP_SYNC_CHANGE_EVENT_REPOSITORY,
  ErpSyncChangeEventRepository,
} from './ports/erp-sync-change-event-repository.port';
import { PRODUCT_CATALOG_WRITER } from '../../../shared/contracts/tokens';
import { ProductCatalogWriter } from '../../../shared/contracts/product-catalog-writer.port';
import {
  PROVIDER_SYNC_LOG_REPOSITORY,
  ProviderSyncLogRepository,
} from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import {
  PROVIDER_HEALTH_REPOSITORY,
  ProviderHealthRepository,
} from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { computeContentHash } from '../../../shared/domain/content-hash';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { OlistApiClient } from '../infrastructure/olist/olist-api.client';
import { ProductPhotoMirrorService } from './product-photo-mirror.service';
import { InvalidOlistProductError, normalizeOlistProduct } from '../domain/olist-product-normalizer';

export const PROVIDER_CODE = 'OLIST_TINY_API_V2';
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 8000, 32000];

// Pipeline (docs/erp-integration-architecture.md, seção 6): Fetch -> Normalize
// -> Hash & Diff -> Upsert via porta do Catalog -> Log -> (fotos espelhadas
// à parte, só quando o hash mudou, para não rebaixar toda foto a cada sync).
//
// Diferença estrutural em relação ao RuleSyncOrchestrator (Marketplace
// Intelligence): lá existe UM provider compartilhado por todos os tenants
// (dados públicos de mercado). Aqui cada tenant tem sua própria credencial
// e seu próprio catálogo — o orquestrador itera sobre todas as
// OlistConnection ativas, uma sincronização por tenant, isoladas entre si
// (uma conta com token inválido não impede as demais).
@Injectable()
export class ErpSyncOrchestrator {
  private readonly logger = new Logger(ErpSyncOrchestrator.name);

  constructor(
    @Inject(OLIST_CONNECTION_REPOSITORY) private readonly connections: OlistConnectionRepository,
    @Inject(ERP_SYNC_CHANGE_EVENT_REPOSITORY) private readonly changeEvents: ErpSyncChangeEventRepository,
    @Inject(PRODUCT_CATALOG_WRITER) private readonly catalogWriter: ProductCatalogWriter,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
    private readonly credentials: CredentialEncryptionService,
    private readonly client: OlistApiClient,
    private readonly photoMirror: ProductPhotoMirrorService,
  ) {}

  // Simplificação consciente: o intervalo é o mesmo para todos os tenants
  // (governado por um único ProviderSyncSchedule global, providerCode
  // OLIST_TINY_API_V2) — due-check por tenant usa OlistConnection.lastSyncedAt,
  // não um agendamento individual. Suficiente para o volume atual; virar
  // intervalo por tenant é uma evolução de configuração, não de arquitetura,
  // quando/se algum tenant precisar de uma cadência diferente.
  async syncAllTenants(intervalMinutes: number): Promise<void> {
    const activeConnections = await this.connections.findAllActive();
    const now = Date.now();
    const due = activeConnections.filter(
      (c) => !c.lastSyncedAt || now - c.lastSyncedAt.getTime() >= intervalMinutes * 60_000,
    );
    if (due.length === 0) return;
    this.logger.log(`${due.length} conta(s) com Olist conectado vencida(s) — iniciando sync.`);
    for (const connection of due) {
      await this.syncTenant(connection.tenantId);
    }
  }

  async syncTenant(tenantId: string): Promise<void> {
    const correlationId = randomUUID();
    const logId = await this.syncLogs.start(PROVIDER_CODE, correlationId);
    let candidatesFound = 0;
    let candidatesApplied = 0;

    try {
      const record = await this.connections.findByTenant(tenantId);
      if (!record || !record.isActive) throw new Error('Conexão com o Olist inativa ou não encontrada.');
      const apiToken = this.credentials.decrypt(record.apiTokenEnc);

      const rawProducts = await this.withRetry(() => this.client.fetchAllActiveProductDetails(apiToken));
      candidatesFound = rawProducts.length;
      await this.health.recordSuccess(PROVIDER_CODE);

      for (const raw of rawProducts) {
        try {
          const applied = await this.processProduct(tenantId, raw);
          if (applied) candidatesApplied++;
        } catch (error) {
          if (error instanceof InvalidOlistProductError) {
            this.logger.warn(error.message);
          } else {
            this.logger.error(`Falha ao processar produto do tenant ${tenantId}: ${(error as Error).message}`);
          }
        }
      }

      await this.connections.markSynced(tenantId, new Date());
      await this.syncLogs.finish(logId, { status: 'SUCCESS', candidatesFound, candidatesApplied });
    } catch (error) {
      const consecutiveFailures = await this.health.recordFailure(PROVIDER_CODE, (error as Error).message);
      await this.syncLogs.finish(logId, {
        status: 'FAILED',
        candidatesFound,
        candidatesApplied,
        errorDetails: (error as Error).message,
      });
      this.logger.error(
        `Sync do Olist falhou para o tenant ${tenantId} (${consecutiveFailures} falhas consecutivas): ${(error as Error).message}`,
      );
    }
  }

  private async processProduct(tenantId: string, raw: unknown): Promise<boolean> {
    const normalized = normalizeOlistProduct(raw);

    // Hash sobre os dados ORIGINAIS do Olist (antes de espelhar fotos) —
    // assim uma foto que só trocou de URL no Olist mas é visualmente igual
    // não dispara re-download; e mudanças reais (preço, estoque, etc.)
    // sempre disparam, mesmo que as fotos não tenham mudado.
    const contentHash = computeContentHash(normalized);
    const previous = await this.changeEvents.findByExternalId(tenantId, normalized.externalId);

    if (previous && previous.contentHash === contentHash) {
      return false; // nada mudou — não baixa foto de novo, não toca no Catalog
    }

    const photoUrls = await this.photoMirror.mirrorAll(tenantId, normalized.skuCode, normalized.photoUrls);

    const { changed } = await this.catalogWriter.upsertFromExternalSource({
      tenantId,
      skuCode: normalized.skuCode,
      name: normalized.name,
      costPrice: normalized.costPrice,
      stockQuantity: normalized.stockQuantity,
      weightKg: normalized.weightKg,
      packagingWeightKg: normalized.packagingWeightKg,
      lengthCm: normalized.lengthCm,
      widthCm: normalized.widthCm,
      heightCm: normalized.heightCm,
      photoUrls,
      erpSalePrice: normalized.erpSalePrice,
      sourceSystem: 'ERP_OLIST',
      externalId: normalized.externalId,
    });

    await this.changeEvents.upsert({
      tenantId,
      externalId: normalized.externalId,
      skuCode: normalized.skuCode,
      changeSummary: previous ? 'Produto atualizado a partir do Olist.' : 'Produto importado do Olist pela primeira vez.',
      action: previous ? 'UPDATED' : 'CREATED',
      contentHash,
    });

    return changed;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
        }
      }
    }
    throw lastError;
  }
}
