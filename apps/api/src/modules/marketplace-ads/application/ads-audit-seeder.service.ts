import { Inject, Injectable, Logger } from '@nestjs/common';
import { ADS_CAMPAIGN_REPOSITORY, AdsCampaignRepository } from './ports/ads-campaign-repository.port';
import { ADS_ACTION_SUGGESTION_REPOSITORY, AdsActionSuggestionRepository } from './ports/ads-action-suggestion-repository.port';

// Modo de Demonstração / Audit Mode no módulo de Ads — mesmo racional do
// AuditSeederService (Orders, ver docs/audit-mode.md): injeta um conjunto
// FIXO de campanhas fictícias com externalCampaignId FIXO (DEMO-ADS-CAMP-
// 001..004) e isDemo=true, direto via ADS_CAMPAIGN_REPOSITORY/
// ADS_ACTION_SUGGESTION_REPOSITORY — nunca via um AdsCapableProvider real
// nem via AdsSyncOrchestrator. Idempotente pela mesma chave de negócio
// (tenantId, channelCode, externalCampaignId) que o sync real usa.
//
// Cobre deliberadamente os 3 tiers de classifyCampaignHealth que IMPORTAM
// para a demonstração (ESTRELA/PONTO_DE_ATENCAO/CUSTO_PERDIDO — SEM_DADOS
// não precisa de cenário, é só "campanha sem métrica nenhuma") MAIS as 2
// origens de sugestão de ação (RULE_BASED e AI) — é o requisito explícito
// do briefing: o card de sugestão da IA (reasoning + confidenceScore em
// destaque) precisa ter algo real para renderizar em Demo Mode, para que a
// "confirmação humana" seja demonstrável na auditoria da Amazon/Shopee.
export interface AdsAuditSeedResult {
  seededCampaigns: number;
  seededSuggestions: number;
  externalCampaignIds: string[];
}

export interface AdsAuditClearResult {
  removedCampaigns: number;
  removedSuggestions: number;
}

export interface AdsAuditStatus {
  totalDemoCampaigns: number;
}

interface DemoDailyMetric {
  daysAgo: number;
  spend: number;
  revenueAds: number;
  clicks: number;
  impressions: number;
}

interface DemoSuggestionScenario {
  reason: string;
  aiFields?: { confidenceScore: number; metadata: Record<string, unknown> };
}

interface DemoCampaignScenario {
  externalCampaignId: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED' | 'UNKNOWN';
  dailyBudget: number | null;
  dailyMetrics: DemoDailyMetric[];
  suggestion?: DemoSuggestionScenario;
}

function daysAgoDate(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

@Injectable()
export class AdsAuditSeederService {
  private readonly logger = new Logger(AdsAuditSeederService.name);

  constructor(
    @Inject(ADS_CAMPAIGN_REPOSITORY) private readonly campaigns: AdsCampaignRepository,
    @Inject(ADS_ACTION_SUGGESTION_REPOSITORY) private readonly suggestions: AdsActionSuggestionRepository,
  ) {}

  // Todos os cenários no canal MERCADO_LIVRE de propósito — é o único canal
  // com Ads de verdade integrado hoje (Fase 1-4 escopo ML, ver
  // docs/marketplace-ads-architecture.md); um cenário demo em Shopee/TikTok
  // sugeriria uma integração que não existe.
  private buildScenarios(): DemoCampaignScenario[] {
    return [
      // 1) ESTRELA — ROAS ~5,1, volume relevante (422 cliques/7 dias):
      // recomendação de aumentar orçamento, sem sugestão de ação (só
      // PAUSE_CAMPAIGN existe hoje, e não faz sentido aqui).
      {
        externalCampaignId: 'DEMO-ADS-CAMP-001',
        name: 'Sérum Facial Vitamina C — Patrocinado (Demo)',
        status: 'ACTIVE',
        dailyBudget: 80,
        dailyMetrics: [
          { daysAgo: 7, spend: 75, revenueAds: 360, clicks: 55, impressions: 2400 },
          { daysAgo: 6, spend: 80, revenueAds: 410, clicks: 62, impressions: 2600 },
          { daysAgo: 5, spend: 78, revenueAds: 395, clicks: 58, impressions: 2500 },
          { daysAgo: 4, spend: 82, revenueAds: 430, clicks: 65, impressions: 2700 },
          { daysAgo: 3, spend: 79, revenueAds: 405, clicks: 60, impressions: 2550 },
          { daysAgo: 2, spend: 83, revenueAds: 440, clicks: 63, impressions: 2650 },
          { daysAgo: 1, spend: 81, revenueAds: 420, clicks: 59, impressions: 2500 },
        ],
      },
      // 2) PONTO_DE_ATENCAO — ROAS 1,5, volume alto (350 cliques): revisar
      // criativo/título antes de cortar orçamento. Também sem sugestão de
      // ação — mesma regra de shouldSuggestPauseAction (só CUSTO_PERDIDO).
      {
        externalCampaignId: 'DEMO-ADS-CAMP-002',
        name: 'Kit Skincare Noturno — Awareness (Demo)',
        status: 'ACTIVE',
        dailyBudget: 100,
        dailyMetrics: [
          { daysAgo: 7, spend: 95, revenueAds: 140, clicks: 48, impressions: 2100 },
          { daysAgo: 6, spend: 102, revenueAds: 155, clicks: 52, impressions: 2300 },
          { daysAgo: 5, spend: 98, revenueAds: 148, clicks: 50, impressions: 2200 },
          { daysAgo: 4, spend: 105, revenueAds: 160, clicks: 53, impressions: 2350 },
          { daysAgo: 3, spend: 99, revenueAds: 150, clicks: 49, impressions: 2150 },
          { daysAgo: 2, spend: 101, revenueAds: 152, clicks: 51, impressions: 2250 },
          { daysAgo: 1, spend: 100, revenueAds: 145, clicks: 47, impressions: 2100 },
        ],
      },
      // 3) CUSTO_PERDIDO — ROAS 0,39, volume baixo (24 cliques): candidata a
      // pausar. Sugestão de origem AI — o cenário que o briefing pediu para
      // testar o card de sugestão com reasoning/confidenceScore em destaque.
      // Texto e números no mesmo estilo do que AnthropicCampaignAdvisor
      // devolveria de verdade (ver ads-ai-optimization.service.ts).
      {
        externalCampaignId: 'DEMO-ADS-CAMP-003',
        name: 'Perfume Floral 50ml — Descoberta (Demo)',
        status: 'ACTIVE',
        dailyBudget: 50,
        dailyMetrics: [
          { daysAgo: 7, spend: 40, revenueAds: 15, clicks: 3, impressions: 650 },
          { daysAgo: 6, spend: 45, revenueAds: 18, clicks: 4, impressions: 700 },
          { daysAgo: 5, spend: 42, revenueAds: 16, clicks: 3, impressions: 680 },
          { daysAgo: 4, spend: 48, revenueAds: 20, clicks: 4, impressions: 720 },
          { daysAgo: 3, spend: 44, revenueAds: 17, clicks: 3, impressions: 690 },
          { daysAgo: 2, spend: 46, revenueAds: 19, clicks: 4, impressions: 710 },
          { daysAgo: 1, spend: 43, revenueAds: 16, clicks: 3, impressions: 680 },
        ],
        suggestion: {
          reason:
            'IA (Claude): ROAS de 0,39 nos últimos 7 dias, bem abaixo da meta de 3,0 configurada para o tenant, ' +
            'com apenas 24 cliques no período — volume insuficiente para o investimento atual gerar retorno. ' +
            'Recomendo pausar esta campanha e redirecionar o orçamento para campanhas com sinal mais forte, ' +
            'como a de Sérum Facial Vitamina C (ROAS 5,1 no mesmo período).',
          aiFields: {
            confidenceScore: 0.87,
            metadata: {
              targetRoas: 3,
              observedRoas: 0.39,
              roasTrendDays: 7,
              suggestedAction: 'PAUSE_CAMPAIGN',
              spendAtRisk: 308,
            },
          },
        },
      },
      // 4) CUSTO_PERDIDO — ROAS 0,27, volume ainda mais baixo (12 cliques):
      // mesmo tier da campanha 3, mas sugestão de origem RULE_BASED (o
      // caminho padrão da Fase 2/3, texto idêntico ao que
      // classifyCampaignHealth já calcula) — para o dashboard mostrar as 2
      // origens lado a lado, não só a mais chamativa.
      {
        externalCampaignId: 'DEMO-ADS-CAMP-004',
        name: 'Máscara de Argila — Liquidação (Demo)',
        status: 'ACTIVE',
        dailyBudget: 40,
        dailyMetrics: [
          { daysAgo: 7, spend: 30, revenueAds: 8, clicks: 2, impressions: 500 },
          { daysAgo: 6, spend: 32, revenueAds: 9, clicks: 2, impressions: 520 },
          { daysAgo: 5, spend: 29, revenueAds: 7, clicks: 1, impressions: 480 },
          { daysAgo: 4, spend: 33, revenueAds: 10, clicks: 2, impressions: 540 },
          { daysAgo: 3, spend: 31, revenueAds: 8, clicks: 2, impressions: 510 },
          { daysAgo: 2, spend: 28, revenueAds: 7, clicks: 1, impressions: 470 },
          { daysAgo: 1, spend: 30, revenueAds: 8, clicks: 2, impressions: 500 },
        ],
        suggestion: {
          reason: 'Baixo volume e ROAS ruim — candidata a pausar.',
        },
      },
    ];
  }

  // Idempotente: mesma chave de negócio (tenantId, channelCode,
  // externalCampaignId) para campanhas, e findOpenSuggestion antes de criar
  // (mesma trava de idempotência que AdsAlertingService usa de verdade) para
  // sugestões — rodar seed() de novo nunca duplica nada, só atualiza.
  async seed(tenantId: string): Promise<AdsAuditSeedResult> {
    const scenarios = this.buildScenarios();
    let seededSuggestions = 0;

    for (const scenario of scenarios) {
      const campaignId = await this.campaigns.seedDemoCampaign(tenantId, {
        channelCode: 'MERCADO_LIVRE',
        externalCampaignId: scenario.externalCampaignId,
        name: scenario.name,
        status: scenario.status,
        dailyBudget: scenario.dailyBudget,
      });

      for (const metric of scenario.dailyMetrics) {
        await this.campaigns.seedDemoMetricSnapshot(tenantId, campaignId, {
          periodDate: daysAgoDate(metric.daysAgo),
          spend: metric.spend,
          revenueAds: metric.revenueAds,
          clicks: metric.clicks,
          impressions: metric.impressions,
        });
      }

      if (scenario.suggestion) {
        const existing = await this.suggestions.findOpenSuggestion(campaignId, 'PAUSE_CAMPAIGN');
        if (!existing) {
          await this.suggestions.createPending(
            tenantId,
            campaignId,
            'PAUSE_CAMPAIGN',
            scenario.suggestion.reason,
            scenario.suggestion.aiFields ? { source: 'AI', ...scenario.suggestion.aiFields } : undefined,
          );
          seededSuggestions++;
        }
      }
    }

    this.logger.log(
      `Audit Mode (Ads): ${scenarios.length} campanha(s) de demonstração semeadas para o tenant ${tenantId} (${seededSuggestions} sugestão(ões) nova(s)).`,
    );
    return {
      seededCampaigns: scenarios.length,
      seededSuggestions,
      externalCampaignIds: scenarios.map((s) => s.externalCampaignId),
    };
  }

  // Ordem importa pela FK campaignId: sugestões demo primeiro, depois
  // métricas+campanhas (deleteDemoCampaigns já cuida das métricas).
  async clear(tenantId: string): Promise<AdsAuditClearResult> {
    const removedSuggestions = await this.suggestions.deleteDemoSuggestions(tenantId);
    const removedCampaigns = await this.campaigns.deleteDemoCampaigns(tenantId);
    this.logger.log(
      `Audit Mode (Ads): ${removedCampaigns} campanha(s) e ${removedSuggestions} sugestão(ões) de demonstração removidas do tenant ${tenantId}.`,
    );
    return { removedCampaigns, removedSuggestions };
  }

  async getStatus(tenantId: string): Promise<AdsAuditStatus> {
    const totalDemoCampaigns = await this.campaigns.countDemoCampaigns(tenantId);
    return { totalDemoCampaigns };
  }
}
