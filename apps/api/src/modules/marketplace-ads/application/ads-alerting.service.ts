import { Inject, Injectable, Logger } from '@nestjs/common';
import { ADS_CAMPAIGN_REPOSITORY, AdsCampaignRepository, AdsCampaignSummary } from './ports/ads-campaign-repository.port';
import { ADS_ACTION_SUGGESTION_REPOSITORY, AdsActionSuggestionRepository } from './ports/ads-action-suggestion-repository.port';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';
import {
  classifyCampaignHealth,
  determineAlertAction,
  shouldSuggestPauseAction,
  CampaignHealthResult,
  CampaignMetricsTotals,
} from '../domain/ads-metrics';

const ZERO_TOTALS: CampaignMetricsTotals = { spend: 0, revenueAds: 0, clicks: 0, impressions: 0 };

// Alertas inteligentes (Fase 2) + gatilho de sugestão de ação (Fase 3 —
// Safety Lock). Avalia a saúde de cada campanha de um tenant/canal (mesma
// função pura de domínio que já alimenta o dashboard, classifyCampaignHealth)
// e decide se dispara um alerta, via a máquina de estado determineAlertAction
// (domain/ads-metrics.ts): alerta uma vez quando a campanha DEGRADA para
// CUSTO_PERDIDO, nunca repete enquanto ela continuar ruim, e reseta o estado
// quando ela se recupera — evitando tanto spam (alertar a cada sync de 2h)
// quanto silêncio permanente (nunca mais alertar depois da primeira vez,
// mesmo que a campanha piore de novo após recuperar).
//
// Reaproveita o MESMO ALERT_SERVICE já usado por falhas técnicas de sync
// (OrderSyncOrchestrator, AdsSyncOrchestrator) — não existe um canal de
// "alerta de negócio" separado ainda nesta plataforma; a severidade WARNING
// e o `source` distinto ("AdsAlertingService") já são suficientes para
// diferenciar isto de uma falha técnica, e a mesma porta permite trocar o
// destino (console -> Slack/e-mail) no futuro sem tocar aqui.
//
// Deliberadamente NÃO usa TACOS/receita do tenant (ORDER_FINANCIALS_READER):
// a saúde de uma campanha é uma propriedade DELA (spend/revenueAds/clicks),
// não do tenant inteiro — ver domain/ads-metrics.ts, classifyCampaignHealth.
// Isso mantém este serviço desacoplado de OrdersModule, ao contrário de
// AdsInsightsService (que precisa do TACOS agregado para o dashboard).
//
// Fase 3 (Safety Lock): quando a ação é ALERT, além de emitir o alerta,
// também cria uma AdsActionSuggestion PENDING (se ainda não houver uma
// aberta para a mesma campanha) — MESMO evento, nunca uma segunda regra
// paralela (ver domain/ads-metrics.ts, shouldSuggestPauseAction). A
// sugestão nunca é aplicada automaticamente aqui: só fica esperando
// confirmação explícita do usuário via AdsActionDispatcherService.
@Injectable()
export class AdsAlertingService {
  private readonly logger = new Logger(AdsAlertingService.name);

  constructor(
    @Inject(ADS_CAMPAIGN_REPOSITORY) private readonly campaigns: AdsCampaignRepository,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
    @Inject(ADS_ACTION_SUGGESTION_REPOSITORY) private readonly actionSuggestions: AdsActionSuggestionRepository,
  ) {}

  async evaluateAndAlert(tenantId: string, channelCode: string, dateFrom: Date, dateTo: Date): Promise<void> {
    // Sequencial, não Promise.all: sem campanha nenhuma para este
    // tenant/canal, não há motivo para pagar a segunda consulta
    // (sumMetricsByCampaign) — sai cedo antes de tocar o banco de novo.
    const campaignSummaries = await this.campaigns.listCampaigns(tenantId, channelCode);
    if (campaignSummaries.length === 0) return;

    const metricTotals = await this.campaigns.sumMetricsByCampaign(tenantId, dateFrom, dateTo);
    const totalsByCampaignId = new Map(metricTotals.map((m) => [m.campaignId, m]));

    for (const campaign of campaignSummaries) {
      try {
        await this.evaluateCampaign(tenantId, campaign, totalsByCampaignId.get(campaign.id));
      } catch (error) {
        // Falha ao avaliar/persistir o estado de UMA campanha não pode
        // impedir a avaliação das demais — mesma disciplina de item-failure
        // isolado já usada em AdsSyncOrchestrator.
        this.logger.error(
          `Falha ao avaliar alerta da campanha ${campaign.externalCampaignId} (${channelCode}, tenant ${tenantId}): ${(error as Error).message}`,
        );
      }
    }
  }

  private async evaluateCampaign(
    tenantId: string,
    campaign: AdsCampaignSummary,
    rawTotals: CampaignMetricsTotals | undefined,
  ): Promise<void> {
    const totals = rawTotals ?? ZERO_TOTALS;
    const health = classifyCampaignHealth(totals);
    const action = determineAlertAction(campaign.lastAlertedTier, health.tier);

    if (action === 'NONE') return;

    if (action === 'ALERT') {
      this.alerts.emitAlert({
        source: 'AdsAlertingService',
        severity: 'WARNING',
        message: `Campanha "${campaign.name}" (${campaign.channelCode}) entrou em CUSTO_PERDIDO`,
        context: {
          tenantId,
          campaignId: campaign.id,
          externalCampaignId: campaign.externalCampaignId,
          channelCode: campaign.channelCode,
          tier: health.tier,
          recommendation: health.recommendation,
          totals,
        },
      });
      await this.campaigns.updateAlertState(campaign.id, health.tier, new Date());
      await this.maybeSuggestPauseAction(tenantId, campaign, health);
      return;
    }

    // action === 'RESET'
    await this.campaigns.updateAlertState(campaign.id, null, null);
  }

  // Fase 3 — Safety Lock. Só CRIA a sugestão; nunca aplica. Idempotente por
  // campanha+ação: se já existe uma sugestão PENDING ou CONFIRMED para esta
  // campanha, não empilha outra — o usuário ainda não decidiu sobre a
  // anterior, uma segunda sugestão idêntica não ajudaria em nada.
  private async maybeSuggestPauseAction(tenantId: string, campaign: AdsCampaignSummary, health: CampaignHealthResult): Promise<void> {
    if (!shouldSuggestPauseAction(health.tier)) return;

    const existing = await this.actionSuggestions.findOpenSuggestion(campaign.id, 'PAUSE_CAMPAIGN');
    if (existing) return;

    await this.actionSuggestions.createPending(tenantId, campaign.id, 'PAUSE_CAMPAIGN', health.recommendation);
  }
}
