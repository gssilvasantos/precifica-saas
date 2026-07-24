import { Module } from '@nestjs/common';
import { AdsProviderRegistry, ADS_CAPABLE_PROVIDERS } from './application/ads-provider-registry.service';
import { AdsSyncOrchestrator } from './application/ads-sync-orchestrator.service';
import { AdsInsightsService } from './application/ads-insights.service';
import { AdsAlertingService } from './application/ads-alerting.service';
import { AdsActionDispatcherService } from './application/ads-action-dispatcher.service';
import { AdsAiOptimizationService } from './application/ads-ai-optimization.service';
import { AdsAuditSeederService } from './application/ads-audit-seeder.service';
import { ADS_CAMPAIGN_REPOSITORY } from './application/ports/ads-campaign-repository.port';
import { ADS_ACTION_SUGGESTION_REPOSITORY } from './application/ports/ads-action-suggestion-repository.port';
import { PrismaAdsCampaignRepository } from './infrastructure/prisma-ads-campaign.repository';
import { PrismaAdsActionSuggestionRepository } from './infrastructure/prisma-ads-action-suggestion.repository';
import { AnthropicCampaignAdvisor } from './infrastructure/ai/anthropic-campaign-advisor.service';
import { AdsSyncSchedulerJob } from './infrastructure/scheduler/ads-sync-scheduler.job';
import { AdsAiOptimizationSchedulerJob } from './infrastructure/scheduler/ads-ai-optimization-scheduler.job';
import { AdsInsightsController } from './interface/controllers/ads-insights.controller';
import { AdsSyncController } from './interface/controllers/ads-sync.controller';
import { AdsActionsController } from './interface/controllers/ads-actions.controller';
import { AdsAuditModeController } from './interface/controllers/ads-audit-mode.controller';
import { SyncOpsModule } from '../../shared/sync-ops/sync-ops.module';
import { ObservabilityModule } from '../../shared/observability/observability.module';
import { OrdersModule } from '../orders/orders.module';
import { CatalogModule } from '../catalog/catalog.module';
import { MarketplaceIntelligenceModule } from '../marketplace-intelligence/marketplace-intelligence.module';
import { MercadoLivreAdsProvider } from '../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-ads.provider';
import { CAMPAIGN_OPTIMIZATION_ADVISOR } from '../../shared/contracts/campaign-optimization-advisor.port';

// Módulo de Ads multicanal — Fase 1 (dashboard de leitura, escopo Mercado
// Livre) + Fase 2 (alertas inteligentes) + Fase 3 (automação de escrita com
// Safety Lock) + Fase 4 (sugestão via IA), ver docs/marketplace-ads-architecture.md
// e docs/marketplace-ads-ai-fase4-architecture.md.
// Mesmo padrão de composição de OrdersModule/FinancialIntelligenceModule:
// importa outros módulos SÓ para consumir uma porta/provider já exportado,
// nunca a classe concreta reimplementada aqui.
//
// - SyncOpsModule: agenda/log/saúde de sync — mesma infra genérica do resto
//   da plataforma (AdsSyncOrchestrator consome PROVIDER_SYNC_LOG_REPOSITORY/
//   PROVIDER_HEALTH_REPOSITORY).
// - ObservabilityModule: ALERT_SERVICE, mesmo racional de todo orquestrador
//   de sync já existente — reaproveitado também por AdsAlertingService (Fase 2).
// - MarketplaceIntelligenceModule: só para consumir MercadoLivreAdsProvider
//   (exportado de lá — vive junto de MercadoLivreOrderProvider/
//   MercadoLivreConnectionService, mesmo canal, mesma credencial OAuth2).
// - OrdersModule: só para consumir ORDER_FINANCIALS_READER — a MESMA porta
//   que já alimenta o DRE (FinancialIntelligenceModule) — o TACOS precisa
//   da receita TOTAL do tenant, nunca uma segunda fonte de "quanto foi
//   vendido organicamente" (ver domain/ads-metrics.ts).
// - CatalogModule (Fase 4): só para consumir FINANCIAL_POLICY_READER — a
//   MESMA porta que já alimenta o piso financeiro do Pricing Intelligence —
//   AdsAiOptimizationService lê targetRoas de lá, nunca uma segunda fonte de
//   "meta de ROAS do tenant".
//
// Nenhum import circular: nem MarketplaceIntelligenceModule, nem OrdersModule,
// nem CatalogModule importa MarketplaceAdsModule de volta.
@Module({
  imports: [SyncOpsModule, ObservabilityModule, MarketplaceIntelligenceModule, OrdersModule, CatalogModule],
  controllers: [AdsInsightsController, AdsSyncController, AdsActionsController, AdsAuditModeController],
  providers: [
    AdsProviderRegistry,
    AdsSyncOrchestrator,
    AdsInsightsService,
    // Fase 2 — alertas inteligentes, consumido por AdsSyncOrchestrator logo
    // após persistir campanhas/métricas de cada tenant. Ver domain/ads-metrics.ts
    // (determineAlertAction) e docs/marketplace-ads-architecture.md, seção 11.
    AdsAlertingService,
    // Fase 3 — Safety Lock: o único lugar do sistema que efetivamente chama
    // uma ação de escrita (pauseCampaign) contra um marketplace, e só depois
    // de confirmação explícita do usuário via AdsActionsController.
    AdsActionDispatcherService,
    // Fase 4 — sugestão via IA: cria AdsActionSuggestion (source: AI) pelo
    // MESMO repositório da Fase 2/3, nunca aplica nada sozinha. Ver
    // docs/marketplace-ads-ai-fase4-architecture.md.
    AdsAiOptimizationService,
    // Modo de Demonstração / Audit Mode — mesmo racional de AuditSeederService
    // (Orders), escopo Ads: ver AdsAuditModeController + docs/audit-mode.md.
    AdsAuditSeederService,
    AdsSyncSchedulerJob,
    AdsAiOptimizationSchedulerJob,
    { provide: ADS_CAMPAIGN_REPOSITORY, useClass: PrismaAdsCampaignRepository },
    { provide: ADS_ACTION_SUGGESTION_REPOSITORY, useClass: PrismaAdsActionSuggestionRepository },
    // Fase 4 — porta de IA (shared/contracts/campaign-optimization-advisor.port.ts).
    // Trocável por outro provider (OpenAI, ou os dois com fallback) sem
    // tocar em AdsAiOptimizationService — mesmo racional de AlertService/FileStorage.
    { provide: CAMPAIGN_OPTIMIZATION_ADVISOR, useClass: AnthropicCampaignAdvisor },
    // Registro central de providers de Ads (mesmo padrão de
    // ORDER_CAPABLE_PROVIDERS/MARKETPLACE_PROVIDERS): adicionar um canal
    // novo (Shopee, TikTok...) é registrar mais um AdsCapableProvider aqui,
    // nunca alterar AdsProviderRegistry/AdsSyncOrchestrator/AdsInsightsService.
    {
      provide: ADS_CAPABLE_PROVIDERS,
      useFactory: (ml: MercadoLivreAdsProvider) => [ml],
      inject: [MercadoLivreAdsProvider],
    },
  ],
  exports: [],
})
export class MarketplaceAdsModule {}
