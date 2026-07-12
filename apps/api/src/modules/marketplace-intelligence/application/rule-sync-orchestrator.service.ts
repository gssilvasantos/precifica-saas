import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { FeeRuleCapableProvider, RawRuleCandidate } from '../../../shared/contracts/marketplace-provider.contract';
import { MARKETPLACE_REPOSITORY, MarketplaceRepository } from './ports/marketplace-repository.port';
import { MARKETPLACE_RULE_REPOSITORY, MarketplaceRuleRepository } from './ports/marketplace-rule-repository.port';
import { CHANGE_EVENT_REPOSITORY, ChangeEventRepository } from './ports/change-event-repository.port';
import {
  PROVIDER_SYNC_SCHEDULE_REPOSITORY,
  ProviderSyncScheduleRepository,
} from '../../../shared/sync-ops/ports/provider-sync-schedule-repository.port';
import {
  PROVIDER_SYNC_LOG_REPOSITORY,
  ProviderSyncLogRepository,
} from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import {
  PROVIDER_HEALTH_REPOSITORY,
  ProviderHealthRepository,
} from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { computeContentHash } from '../../../shared/domain/content-hash';
import { RULE_PAYLOAD_VALIDATORS } from '../domain/rule-payload-validators';
import { MarketplaceProviderRegistry } from './marketplace-provider-registry.service';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 8000, 32000];

// O pipeline descrito na seção 5.2 do documento de arquitetura do módulo:
// Fetch -> Normalize -> Hash & Diff -> Decide -> Persist -> Emit. Cobre hoje
// só FEE_RULE; SHIPPING_POLICY e CATEGORY_TAXONOMY seguem o mesmo desenho
// quando algum provider implementar essas capacidades.
@Injectable()
export class RuleSyncOrchestrator {
  private readonly logger = new Logger(RuleSyncOrchestrator.name);

  constructor(
    private readonly registry: MarketplaceProviderRegistry,
    @Inject(MARKETPLACE_REPOSITORY) private readonly marketplaces: MarketplaceRepository,
    @Inject(MARKETPLACE_RULE_REPOSITORY) private readonly rules: MarketplaceRuleRepository,
    @Inject(CHANGE_EVENT_REPOSITORY) private readonly changeEvents: ChangeEventRepository,
    @Inject(PROVIDER_SYNC_SCHEDULE_REPOSITORY) private readonly schedules: ProviderSyncScheduleRepository,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
    private readonly events: EventEmitter2,
  ) {}

  async syncFeeRules(providerCode: string): Promise<void> {
    const provider = this.registry.findByCode(providerCode);
    if (!provider || !('fetchFeeRules' in provider)) {
      this.logger.warn(`Provider ${providerCode} não registrado ou não suporta FEE_RULES — pulando.`);
      return;
    }
    const feeProvider = provider as unknown as FeeRuleCapableProvider;
    const schedule = await this.schedules.findByProviderCode(providerCode);

    // Providers de dado POR TENANT (ex.: NuvemshopFeeRuleProvider) declaram
    // listTenantIdsToSync() — sincroniza uma vez por tenant, cada um gerando
    // MarketplaceRule com tenantId preenchido (nunca null). Providers de
    // dado global (ex.: Mercado Livre) não implementam isso: uma única
    // passada, tenantId null, comportamento idêntico ao de antes desta
    // extensão (ver docs/erp-integration-architecture.md, seção Nuvemshop).
    const tenantIds: (string | null)[] = provider.listTenantIdsToSync ? await provider.listTenantIdsToSync() : [null];
    if (tenantIds.length === 0) {
      this.logger.log(`Provider ${providerCode} não tem nenhum tenant elegível para sync agora — nada a fazer.`);
      return;
    }

    for (const tenantId of tenantIds) {
      await this.runSyncPass(providerCode, provider, feeProvider, schedule?.autoTrust ?? false, tenantId);
    }

    if (schedule) await this.schedules.markRun(schedule.id, 'SUCCESS', new Date());
  }

  private async runSyncPass(
    providerCode: string,
    provider: { code: string; marketplaceCode: string; sourceType: 'OFFICIAL_API' | 'OFFICIAL_DOCS' | 'IMPORTED_FILE' | 'MANUAL' },
    feeProvider: FeeRuleCapableProvider,
    autoTrust: boolean,
    tenantId: string | null,
  ): Promise<void> {
    const correlationId = randomUUID();
    const logId = await this.syncLogs.start(providerCode, correlationId);
    let candidatesFound = 0;
    let candidatesApplied = 0;

    try {
      const marketplace = await this.marketplaces.findByCode(provider.marketplaceCode);
      if (!marketplace) throw new Error(`Marketplace ${provider.marketplaceCode} não cadastrado.`);

      const rawCandidates = await this.withRetry(() =>
        feeProvider.fetchFeeRules({ marketplaceCode: provider.marketplaceCode, tenantId: tenantId ?? undefined }),
      );
      candidatesFound = rawCandidates.length;
      await this.health.recordSuccess(providerCode);

      for (const raw of rawCandidates) {
        try {
          const applied = await this.processFeeRuleCandidate(marketplace.id, provider, raw, autoTrust, tenantId);
          if (applied) candidatesApplied++;
        } catch (error) {
          this.logger.error(
            `Candidato inválido de ${providerCode} (scopeKey=${raw.scopeKey}, tenant=${tenantId ?? 'global'}): ${(error as Error).message}`,
          );
        }
      }

      await this.syncLogs.finish(logId, { status: 'SUCCESS', candidatesFound, candidatesApplied });
    } catch (error) {
      const consecutiveFailures = await this.health.recordFailure(providerCode, (error as Error).message);
      await this.syncLogs.finish(logId, {
        status: 'FAILED',
        candidatesFound,
        candidatesApplied,
        errorDetails: (error as Error).message,
      });
      this.logger.error(
        `Sync de ${providerCode} (tenant=${tenantId ?? 'global'}) falhou (${consecutiveFailures} falhas consecutivas): ${(error as Error).message}`,
      );
    }
  }

  private async processFeeRuleCandidate(
    marketplaceId: string,
    provider: { code: string; sourceType: 'OFFICIAL_API' | 'OFFICIAL_DOCS' | 'IMPORTED_FILE' | 'MANUAL' },
    raw: RawRuleCandidate,
    autoTrust: boolean,
    tenantId: string | null,
  ): Promise<boolean> {
    const validator = RULE_PAYLOAD_VALIDATORS.FEE_RULE;
    const normalizedPayload = validator(raw.payload); // lança se malformado — resiliência parcial no chamador

    const contentHash = computeContentHash(normalizedPayload);

    const latestValidated = await this.rules.findLatestValidated(marketplaceId, 'FEE_RULE', raw.scopeKey, tenantId);
    if (latestValidated && latestValidated.contentHash === contentHash) {
      return false; // nada mudou — não polui o histórico nem gera evento
    }

    const latestVersion = await this.rules.findLatestVersion(marketplaceId, 'FEE_RULE', raw.scopeKey, tenantId);
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    // Regra pinada nunca é sobrescrita automaticamente — mesmo detectando
    // mudança, o candidato fica pendente de revisão humana.
    const shouldAutoValidate = autoTrust && !(latestValidated?.pinned ?? false);

    const created = await this.rules.create({
      marketplaceId,
      ruleType: 'FEE_RULE',
      scopeKey: raw.scopeKey,
      payload: normalizedPayload,
      version: nextVersion,
      status: shouldAutoValidate ? 'VALIDADA' : 'PENDENTE_VALIDACAO',
      sourceType: provider.sourceType,
      sourceProviderCode: provider.code,
      sourceFetchedAt: raw.fetchedAt,
      sourceEvidenceRef: raw.sourceEvidenceRef,
      contentHash,
      tenantId: tenantId ?? undefined,
    });

    await this.changeEvents.create({
      marketplaceId,
      ruleType: 'FEE_RULE',
      scopeKey: raw.scopeKey,
      previousRuleId: latestValidated?.id,
      newRuleId: created.id,
      changeSummary: this.summarizeChange(latestValidated?.payload, normalizedPayload),
      detectedByProvider: provider.code,
      resolutionStatus: shouldAutoValidate ? 'AUTO_APPLIED' : 'PENDING_REVIEW',
    });

    this.events.emit(shouldAutoValidate ? 'marketplace-rule.validated' : 'marketplace-rule.pending-review', {
      marketplaceId,
      ruleType: 'FEE_RULE',
      scopeKey: raw.scopeKey,
      tenantId,
      ruleId: created.id,
    });

    return true;
  }

  private summarizeChange(previousPayload: unknown, newPayload: unknown): string {
    if (!previousPayload) return 'Primeira versão registrada para este escopo.';
    const prev = previousPayload as Record<string, unknown>;
    const next = newPayload as Record<string, unknown>;
    const diffs: string[] = [];
    for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
        diffs.push(`${key}: ${JSON.stringify(prev[key])} -> ${JSON.stringify(next[key])}`);
      }
    }
    return diffs.length > 0 ? diffs.join('; ') : 'Payload mudou (diff estrutural vazio — revisar manualmente).';
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
