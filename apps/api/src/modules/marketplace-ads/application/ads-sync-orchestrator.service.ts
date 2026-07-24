import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdsProviderRegistry } from './ads-provider-registry.service';
import { ADS_CAMPAIGN_REPOSITORY, AdsCampaignRepository } from './ports/ads-campaign-repository.port';
import { AdsAlertingService } from './ads-alerting.service';
import { AdsCapableProvider } from '../../../shared/contracts/marketplace-provider.contract';
import {
  PROVIDER_SYNC_LOG_REPOSITORY,
  ProviderSyncLogRepository,
} from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import { PROVIDER_HEALTH_REPOSITORY, ProviderHealthRepository } from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';
import { TenantContextStore } from '../../../shared/prisma/tenant-context';

// Janela de sincronização de métricas — 30 dias é suficiente para o
// dashboard MVP (ROAS/TACOS recentes) e fica bem dentro do limite de 90 dias
// da API do Mercado Livre (ver MercadoLivreAdsProvider). Sem watermark
// persistido por tenant ainda — mesma simplificação consciente do
// OrderSyncOrchestrator (MVP: janela fixa a cada execução, não incremental).
const METRICS_SYNC_WINDOW_DAYS = 30;

// Pipeline por provider: fetchAdsCampaigns -> upsert (devolve id interno) ->
// fetchAdsMetrics -> upsert por campanha. Mesma forma de OrderSyncOrchestrator,
// mais simples (sem eventos de domínio — leitura de performance de mídia não
// dispara nenhuma reação em outro módulo, ao contrário de um pedido pago).
@Injectable()
export class AdsSyncOrchestrator {
  private readonly logger = new Logger(AdsSyncOrchestrator.name);

  constructor(
    private readonly registry: AdsProviderRegistry,
    @Inject(ADS_CAMPAIGN_REPOSITORY) private readonly campaigns: AdsCampaignRepository,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
    private readonly alerting: AdsAlertingService,
  ) {}

  async syncAll(): Promise<void> {
    for (const provider of this.registry.getAll()) {
      await this.syncProvider(provider.code);
    }
  }

  async syncProvider(providerCode: string): Promise<void> {
    const provider = this.registry.findByCode(providerCode);
    if (!provider) {
      this.logger.warn(`Provider de ads ${providerCode} não registrado — pulando.`);
      return;
    }
    if (!provider.listTenantIdsToSync) {
      this.logger.warn(`Provider de ads ${providerCode} não implementa listTenantIdsToSync() — pulando.`);
      return;
    }

    // Descoberta de "quais tenants existem" é a única query legitimamente
    // cross-tenant deste método — escopo de bypass o mais estreito possível
    // (ver docs/row-level-security-architecture.md, seção 3.3). Cada tenant
    // depois reabre seu próprio contexto antes de tocar dado de negócio.
    const tenantIds = await TenantContextStore.runAsService(() => provider.listTenantIdsToSync!());
    for (const tenantId of tenantIds) {
      await TenantContextStore.run(tenantId, () => this.syncTenant(provider, tenantId));
    }
  }

  private async syncTenant(provider: AdsCapableProvider, tenantId: string): Promise<void> {
    const correlationId = randomUUID();
    const logId = await this.syncLogs.start(provider.code, correlationId);
    let candidatesFound = 0;
    let candidatesApplied = 0;

    try {
      const ctx = { marketplaceCode: provider.marketplaceCode, tenantId };
      const rawCampaigns = await provider.fetchAdsCampaigns(ctx);
      candidatesFound += rawCampaigns.length;

      // externalCampaignId -> id interno, resolvido ao upsertar a campanha —
      // necessário para o upsert de métrica logo abaixo (FK, não string solta).
      const internalIdByExternal = new Map<string, string>();
      for (const raw of rawCampaigns) {
        try {
          const internalId = await this.campaigns.upsertCampaign(tenantId, provider.marketplaceCode, raw);
          internalIdByExternal.set(raw.externalCampaignId, internalId);
          candidatesApplied++;
        } catch (error) {
          this.logAndAlertItemFailure(provider.code, tenantId, `campanha ${raw.externalCampaignId}`, error as Error);
        }
      }

      const dateTo = new Date();
      const dateFrom = new Date(dateTo.getTime() - METRICS_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const rawMetrics = await provider.fetchAdsMetrics(ctx, dateFrom, dateTo);
      candidatesFound += rawMetrics.length;

      for (const raw of rawMetrics) {
        const internalCampaignId = internalIdByExternal.get(raw.externalCampaignId);
        if (!internalCampaignId) {
          // Métrica de uma campanha que não veio (ou falhou) no fetch de
          // campanhas deste mesmo ciclo — não é erro do canal, é uma
          // inconsistência momentânea entre as duas chamadas; pulado sem
          // interromper o restante do lote, reconciliado no próximo sync.
          this.logger.warn(
            `Métrica da campanha ${raw.externalCampaignId} (${provider.code}, tenant ${tenantId}) sem campanha correspondente neste ciclo — pulando.`,
          );
          continue;
        }
        try {
          await this.campaigns.upsertMetricSnapshot(tenantId, internalCampaignId, raw);
          candidatesApplied++;
        } catch (error) {
          this.logAndAlertItemFailure(
            provider.code,
            tenantId,
            `métrica ${raw.externalCampaignId}/${raw.periodDate.toISOString().slice(0, 10)}`,
            error as Error,
          );
        }
      }

      // Alertas inteligentes (Fase 2) — avaliado DEPOIS que campanhas e
      // métricas da janela inteira já foram persistidas, nunca durante o
      // loop de upsert (senão os totais estariam incompletos). Uma falha
      // aqui não pode reverter o sync que já persistiu dado bom — por isso
      // é um try/catch PRÓPRIO, separado do try/catch externo que decide
      // SUCCESS/FAILED do sync.
      try {
        const metricsDateTo = new Date();
        const metricsDateFrom = new Date(metricsDateTo.getTime() - METRICS_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        await this.alerting.evaluateAndAlert(tenantId, provider.marketplaceCode, metricsDateFrom, metricsDateTo);
      } catch (error) {
        this.logger.error(
          `Falha ao avaliar alertas de ads (${provider.code}, tenant ${tenantId}): ${(error as Error).message}`,
        );
      }

      await this.health.recordSuccess(provider.code);
      await this.syncLogs.finish(logId, { status: 'SUCCESS', candidatesFound, candidatesApplied });
    } catch (error) {
      await this.health.recordFailure(provider.code, (error as Error).message);
      await this.syncLogs.finish(logId, {
        status: 'FAILED',
        candidatesFound,
        candidatesApplied,
        errorDetails: (error as Error).message,
      });
      const message = `Sync de ads de ${provider.code} (tenant ${tenantId}) falhou: ${(error as Error).message}`;
      this.logger.error(message);
      this.alerts.emitAlert({
        source: 'AdsSyncOrchestrator',
        severity: 'ERROR',
        message: `Sync de ads de ${provider.code} falhou`,
        context: { tenantId, providerCode: provider.code, candidatesFound, candidatesApplied, error: (error as Error).message },
      });
    }
  }

  private logAndAlertItemFailure(providerCode: string, tenantId: string, itemDescription: string, error: Error): void {
    const message = `Falha ao processar ${itemDescription} (${providerCode}, tenant ${tenantId}): ${error.message}`;
    this.logger.error(message);
    this.alerts.emitAlert({
      source: 'AdsSyncOrchestrator',
      severity: 'WARNING',
      message: `Falha ao processar ${itemDescription}`,
      context: { tenantId, providerCode, error: error.message },
    });
  }
}
