import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdsProviderRegistry } from './ads-provider-registry.service';
import { AdsInsightsService, AdsCampaignInsight } from './ads-insights.service';
import { ADS_ACTION_SUGGESTION_REPOSITORY, AdsActionSuggestionRepository } from './ports/ads-action-suggestion-repository.port';
import { CAMPAIGN_OPTIMIZATION_ADVISOR, CampaignOptimizationAdvisor } from '../../../shared/contracts/campaign-optimization-advisor.port';
import { FINANCIAL_POLICY_READER } from '../../../shared/contracts/tokens';
import { FinancialPolicyReader } from '../../../shared/contracts/financial-policy-reader.port';
import { PROVIDER_SYNC_LOG_REPOSITORY, ProviderSyncLogRepository } from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import { PROVIDER_HEALTH_REPOSITORY, ProviderHealthRepository } from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';
import { TenantContextStore } from '../../../shared/prisma/tenant-context';

// Fase 4 (sugestão via IA) — ver docs/marketplace-ads-ai-fase4-architecture.md.
// Irmão de AdsAlertingService (Fase 2), NUNCA o mesmo serviço: os dois criam
// AdsActionSuggestion PENDING pelo MESMO repositório, mas por caminhos
// independentes — um determinístico (threshold de ROAS), um probabilístico
// (LLM). Nenhum dos dois jamais aplica uma ação sozinho; quem faz isso é
// sempre AdsActionDispatcherService, sempre atrás de confirmação humana
// explícita (Fase 3, inalterada por esta fase).
//
// "ADS_AI_ADVISOR" como providerCode nos logs de sync/saúde: reaproveita
// ProviderSyncLogRepository/ProviderHealthRepository (mesma infra genérica
// que já audita todo sync de marketplace) — zero schema novo só para
// auditar execuções desta fase. providerCode é string livre, não amarrado a
// um marketplace real.
const AI_ADVISOR_PROVIDER_CODE = 'ADS_AI_ADVISOR';

// Mesma janela de 30 dias já usada pelo dashboard (AdsInsightsController) e
// pelo sync de métricas (AdsSyncOrchestrator) — nenhuma terceira janela
// inventada.
const INSIGHTS_WINDOW_DAYS = 30;

// Abaixo disto, a sugestão é descartada (não criada) — melhor nenhuma
// sugestão que uma de baixa confiança poluindo a fila do admin. Configurável
// por env para permitir calibrar sem deploy de código.
function getMinConfidence(): number {
  const raw = process.env.ADS_AI_MIN_CONFIDENCE;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : 0.6;
}

@Injectable()
export class AdsAiOptimizationService {
  private readonly logger = new Logger(AdsAiOptimizationService.name);

  constructor(
    private readonly registry: AdsProviderRegistry,
    private readonly insights: AdsInsightsService,
    @Inject(CAMPAIGN_OPTIMIZATION_ADVISOR) private readonly advisor: CampaignOptimizationAdvisor,
    @Inject(ADS_ACTION_SUGGESTION_REPOSITORY) private readonly suggestions: AdsActionSuggestionRepository,
    @Inject(FINANCIAL_POLICY_READER) private readonly financialPolicy: FinancialPolicyReader,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  // Mesma enumeração de tenants de AdsSyncOrchestrator.syncAll: cada provider
  // registrado sabe listar seus próprios tenants conectados
  // (listTenantIdsToSync) — nenhuma segunda fonte de "quais tenants têm ads
  // configurado".
  async runAll(): Promise<void> {
    for (const provider of this.registry.getAll()) {
      if (!provider.listTenantIdsToSync) {
        continue;
      }
      // Mesmo raciocínio de AdsSyncOrchestrator.syncProvider: bypass estreito
      // só para a descoberta de tenants, contexto por tenant reaberto antes
      // de qualquer leitura/escrita de dado de negócio (ver
      // docs/row-level-security-architecture.md, seção 3.3).
      const tenantIds = await TenantContextStore.runAsService(() => provider.listTenantIdsToSync!());
      for (const tenantId of tenantIds) {
        await TenantContextStore.run(tenantId, () => this.runForTenant(tenantId));
      }
    }
  }

  async runForTenant(tenantId: string): Promise<void> {
    const correlationId = randomUUID();
    const logId = await this.syncLogs.start(AI_ADVISOR_PROVIDER_CODE, correlationId);
    let candidatesFound = 0;
    let candidatesApplied = 0;

    try {
      const dateTo = new Date();
      const dateFrom = new Date(dateTo.getTime() - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const dashboard = await this.insights.getDashboard(tenantId, dateFrom, dateTo);

      // SEM_DADOS nunca vai para a IA — dado insuficiente não é sinal, é
      // ausência de sinal (mesmo racional de shouldSuggestPauseAction/
      // determineAlertAction para o caminho determinístico).
      const eligible = dashboard.campaigns.filter((c) => c.tier !== 'SEM_DADOS');
      candidatesFound = eligible.length;

      if (eligible.length === 0) {
        await this.health.recordSuccess(AI_ADVISOR_PROVIDER_CODE);
        await this.syncLogs.finish(logId, { status: 'SUCCESS', candidatesFound: 0, candidatesApplied: 0 });
        return;
      }

      const policy = await this.financialPolicy.getPolicy(tenantId);
      const eligibleById = new Map(eligible.map((c) => [c.campaignId, c]));

      const response = await this.advisor.suggestActions({
        tenantId,
        targetRoas: policy.targetRoas,
        tacos: dashboard.tacos,
        campaigns: eligible.map((c) => this.toCandidate(c)),
      });

      const minConfidence = getMinConfidence();
      for (const suggestion of response.suggestions) {
        if (suggestion.confidenceScore < minConfidence) {
          this.logger.log(
            `Sugestão da IA para a campanha ${suggestion.campaignId} descartada: confiança ${suggestion.confidenceScore} abaixo do mínimo ${minConfidence}.`,
          );
          continue;
        }
        // Defesa extra: o adapter (AnthropicCampaignAdvisor) já valida que
        // campaignId pertence à lista enviada, mas nunca confiamos numa
        // resposta externa em uma única camada — revalidado aqui contra o
        // MESMO conjunto elegível deste ciclo.
        if (!eligibleById.has(suggestion.campaignId)) {
          this.logger.warn(`Sugestão da IA descartada: campanha ${suggestion.campaignId} não está no conjunto elegível deste ciclo.`);
          continue;
        }

        const open = await this.suggestions.findOpenSuggestion(suggestion.campaignId, suggestion.actionType);
        if (open) {
          // Idempotência — mesma regra de AdsAlertingService: não empilha
          // uma segunda sugestão enquanto a anterior (de QUALQUER origem,
          // RULE_BASED ou AI) ainda não foi decidida pelo usuário.
          continue;
        }

        await this.suggestions.createPending(tenantId, suggestion.campaignId, suggestion.actionType, suggestion.reasoning, {
          source: 'AI',
          confidenceScore: suggestion.confidenceScore,
          metadata: suggestion.metadata,
        });
        candidatesApplied++;
      }

      await this.health.recordSuccess(AI_ADVISOR_PROVIDER_CODE);
      await this.syncLogs.finish(logId, { status: 'SUCCESS', candidatesFound, candidatesApplied });
    } catch (error) {
      // NUNCA relança — uma falha de IA (chave ausente, API fora do ar,
      // resposta malformada) é uma degradação de uma feature OPCIONAL, não
      // pode derrubar nada mais no processo que a chama (hoje, só o próprio
      // scheduler desta fase). O caminho determinístico (Fase 2) continua
      // funcionando 100% independente disto.
      await this.health.recordFailure(AI_ADVISOR_PROVIDER_CODE, (error as Error).message);
      await this.syncLogs.finish(logId, {
        status: 'FAILED',
        candidatesFound,
        candidatesApplied,
        errorDetails: (error as Error).message,
      });
      this.logger.warn(`Falha ao consultar IA de otimização de ads (tenant ${tenantId}): ${(error as Error).message}`);
      this.alerts.emitAlert({
        source: 'AdsAiOptimizationService',
        severity: 'WARNING',
        message: 'Falha ao consultar IA de otimização de campanhas de ads',
        context: { tenantId, error: (error as Error).message },
      });
    }
  }

  private toCandidate(c: AdsCampaignInsight) {
    return {
      campaignId: c.campaignId,
      channelCode: c.channelCode,
      name: c.name,
      status: c.status,
      totals: c.totals,
      roas: c.roas,
      tier: c.tier,
      recommendation: c.recommendation,
    };
  }
}
