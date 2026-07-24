import { Module } from '@nestjs/common';
import { MarketplaceProviderRegistry, MARKETPLACE_PROVIDERS } from './application/marketplace-provider-registry.service';
import { RuleSyncOrchestrator } from './application/rule-sync-orchestrator.service';
import { RuleRegistryService } from './application/rule-registry.service';
import { MarketplaceRulesAdminService } from './application/marketplace-rules-admin.service';
import { ChangeEventsQueryService } from './application/change-events-query.service';
import { PriceUpdateDispatcherService } from './application/price-update-dispatcher.service';
import { MercadoLivreConnectionService } from './application/mercado-livre-connection.service';
import { MercadoLivreHandshakeService } from './application/mercado-livre-handshake.service';

import { PrismaMarketplaceRepository } from './infrastructure/prisma-marketplace.repository';
import { PrismaMarketplaceRuleRepository } from './infrastructure/prisma-marketplace-rule.repository';
import { PrismaChangeEventRepository } from './infrastructure/prisma-change-event.repository';
import { PrismaMercadoLivreConnectionRepository } from './infrastructure/prisma-mercado-livre-connection.repository';
import { MercadoLivreApiClient } from './infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreFeeRuleProvider } from './infrastructure/providers/mercado-livre/mercado-livre-fee-rule.provider';
import { MercadoLivreOrderProvider } from './infrastructure/providers/mercado-livre/mercado-livre-order.provider';
import { MercadoLivreAdsProvider } from './infrastructure/providers/mercado-livre/mercado-livre-ads.provider';
import { SyncSchedulerJob } from './infrastructure/scheduler/sync-scheduler.job';

import { MarketplaceRulesAdminController } from './interface/controllers/marketplace-rules-admin.controller';
import { MarketplaceChangeEventsController } from './interface/controllers/marketplace-change-events.controller';
import { MarketplaceProvidersController } from './interface/controllers/marketplace-providers.controller';
import { MercadoLivreConnectionController } from './interface/controllers/mercado-livre-connection.controller';

import { MARKETPLACE_REPOSITORY } from './application/ports/marketplace-repository.port';
import { MARKETPLACE_RULE_REPOSITORY } from './application/ports/marketplace-rule-repository.port';
import { CHANGE_EVENT_REPOSITORY } from './application/ports/change-event-repository.port';
import { MERCADO_LIVRE_CONNECTION_REPOSITORY } from './application/ports/mercado-livre-connection-repository.port';
import { FEE_RULE_RESOLVER, PRICE_UPDATE_DISPATCHER } from '../../shared/contracts/tokens';
import { SyncOpsModule } from '../../shared/sync-ops/sync-ops.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';
import { NuvemshopFeeRuleProvider } from '../erp-integration/infrastructure/nuvemshop/nuvemshop-fee-rule.provider';
import { ObservabilityModule } from '../../shared/observability/observability.module';

@Module({
  imports: [
    SyncOpsModule, // agenda/log/saúde de sync — infra genérica extraída na Etapa 5
    // Só para registrar NuvemshopFeeRuleProvider abaixo — ele mora no
    // erp-integration (precisa das mesmas credenciais/cliente daquele
    // módulo), é só EXPORTADO para cá. erp-integration não importa este
    // módulo de volta, então não há dependência circular.
    ErpIntegrationModule,
    // Só para consumir ALERT_SERVICE (MercadoLivreConnectionService avisa
    // se a renovação automática de token falhar, e
    // MercadoLivreHandshakeService avisa se o teste de conexão falhar).
    ObservabilityModule,
  ],
  controllers: [
    MarketplaceRulesAdminController,
    MarketplaceChangeEventsController,
    MarketplaceProvidersController,
    MercadoLivreConnectionController,
  ],
  providers: [
    MarketplaceProviderRegistry,
    RuleSyncOrchestrator,
    RuleRegistryService,
    MarketplaceRulesAdminService,
    ChangeEventsQueryService,
    PriceUpdateDispatcherService,
    SyncSchedulerJob,

    MercadoLivreApiClient,
    MercadoLivreFeeRuleProvider,
    // Sprint 21 — segunda capacidade do Mercado Livre (ORDERS), classe
    // separada de MercadoLivreFeeRuleProvider. Exportada abaixo para o
    // módulo Orders registrar em ORDER_CAPABLE_PROVIDERS, mesmo racional de
    // NuvemshopOrderProvider ser exportado do erp-integration.
    MercadoLivreOrderProvider,
    // Módulo de Ads, Fase 1 — terceira capacidade do Mercado Livre (ADS),
    // mesmo racional de MercadoLivreOrderProvider: classe separada,
    // reaproveita a MESMA conexão OAuth2 (MercadoLivreConnectionService,
    // abaixo) — nenhuma reautorização do vendedor é necessária, só o escopo
    // advertising/product_ads precisa estar habilitado no app cadastrado no
    // painel do Mercado Livre (ver docs/marketplace-ads-api-access-plan.md).
    // Exportada abaixo para o módulo marketplace-ads registrar em
    // ADS_CAPABLE_PROVIDERS.
    MercadoLivreAdsProvider,
    // Sprint 22 — OAuth2 real por vendedor (docs/auth-security.md). Injetada
    // diretamente em MercadoLivreOrderProvider/MercadoLivreAdsProvider (mesmo
    // módulo, sem precisar de token em shared/contracts) e usada pelo
    // MercadoLivreConnectionController para o fluxo authorize/callback.
    MercadoLivreConnectionService,
    // Fase de Conexão Real — diagnóstico read-only da conexão, ver
    // mercado-livre-handshake.service.ts para o racional completo de por
    // que isto é uma classe separada de MercadoLivreConnectionService.
    MercadoLivreHandshakeService,
    { provide: MERCADO_LIVRE_CONNECTION_REPOSITORY, useClass: PrismaMercadoLivreConnectionRepository },
    // Registro central de providers (seção 12 do documento de arquitetura do
    // módulo): adicionar um marketplace novo = adicionar uma linha aqui,
    // nunca alterar MarketplaceProviderRegistry/RuleSyncOrchestrator.
    {
      provide: MARKETPLACE_PROVIDERS,
      useFactory: (ml: MercadoLivreFeeRuleProvider, nuvemshop: NuvemshopFeeRuleProvider) => [ml, nuvemshop],
      inject: [MercadoLivreFeeRuleProvider, NuvemshopFeeRuleProvider],
    },

    { provide: MARKETPLACE_REPOSITORY, useClass: PrismaMarketplaceRepository },
    { provide: MARKETPLACE_RULE_REPOSITORY, useClass: PrismaMarketplaceRuleRepository },
    { provide: CHANGE_EVENT_REPOSITORY, useClass: PrismaChangeEventRepository },

    // Exporta a PORTA (token), nunca a classe concreta — o futuro Pricing
    // Intelligence só vai conhecer FEE_RULE_RESOLVER + a interface FeeRuleResolver.
    { provide: FEE_RULE_RESOLVER, useExisting: RuleRegistryService },
    // Idem para o comando de repricing — "a regra de ouro" do pedido:
    // Pricing Engine conhece só PRICE_UPDATE_DISPATCHER + a interface.
    { provide: PRICE_UPDATE_DISPATCHER, useExisting: PriceUpdateDispatcherService },
  ],
  exports: [FEE_RULE_RESOLVER, PRICE_UPDATE_DISPATCHER, MercadoLivreOrderProvider, MercadoLivreAdsProvider],
})
export class MarketplaceIntelligenceModule {}
