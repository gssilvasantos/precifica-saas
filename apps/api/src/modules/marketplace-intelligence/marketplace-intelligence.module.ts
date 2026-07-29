import { Module } from '@nestjs/common';
import { MarketplaceProviderRegistry, MARKETPLACE_PROVIDERS } from './application/marketplace-provider-registry.service';
import { RuleSyncOrchestrator } from './application/rule-sync-orchestrator.service';
import { RuleRegistryService } from './application/rule-registry.service';
import { MarketplaceRulesAdminService } from './application/marketplace-rules-admin.service';
import { ChangeEventsQueryService } from './application/change-events-query.service';
import { PriceUpdateDispatcherService } from './application/price-update-dispatcher.service';
import { MercadoLivreConnectionService } from './application/mercado-livre-connection.service';
import { MercadoLivreHandshakeService } from './application/mercado-livre-handshake.service';
import { ShopeeConnectionService } from './application/shopee-connection.service';
import { ShopeeHandshakeService } from './application/shopee-handshake.service';

import { PrismaMarketplaceRepository } from './infrastructure/prisma-marketplace.repository';
import { PrismaMarketplaceRuleRepository } from './infrastructure/prisma-marketplace-rule.repository';
import { PrismaChangeEventRepository } from './infrastructure/prisma-change-event.repository';
import { PrismaMercadoLivreConnectionRepository } from './infrastructure/prisma-mercado-livre-connection.repository';
import { PrismaShopeeConnectionRepository } from './infrastructure/prisma-shopee-connection.repository';
import { MercadoLivreApiClient } from './infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreFeeRuleProvider } from './infrastructure/providers/mercado-livre/mercado-livre-fee-rule.provider';
import { MercadoLivreOrderProvider } from './infrastructure/providers/mercado-livre/mercado-livre-order.provider';
import { MercadoLivreAdsProvider } from './infrastructure/providers/mercado-livre/mercado-livre-ads.provider';
import { MercadoLivreListingProvider } from './infrastructure/providers/mercado-livre/mercado-livre-listing.provider';
import { ShopeeApiClient } from './infrastructure/providers/shopee/shopee-api-client';
import { ShopeeOrderProvider } from './infrastructure/providers/shopee/shopee-order.provider';
import { ShopeeListingProvider } from './infrastructure/providers/shopee/shopee-listing.provider';
import { SyncSchedulerJob } from './infrastructure/scheduler/sync-scheduler.job';

import { MarketplaceRulesAdminController } from './interface/controllers/marketplace-rules-admin.controller';
import { MarketplaceChangeEventsController } from './interface/controllers/marketplace-change-events.controller';
import { MarketplaceProvidersController } from './interface/controllers/marketplace-providers.controller';
import { MercadoLivreConnectionController } from './interface/controllers/mercado-livre-connection.controller';
import { ShopeeConnectionController } from './interface/controllers/shopee-connection.controller';

import { MARKETPLACE_REPOSITORY } from './application/ports/marketplace-repository.port';
import { MARKETPLACE_RULE_REPOSITORY } from './application/ports/marketplace-rule-repository.port';
import { CHANGE_EVENT_REPOSITORY } from './application/ports/change-event-repository.port';
import { MERCADO_LIVRE_CONNECTION_REPOSITORY } from './application/ports/mercado-livre-connection-repository.port';
import { SHOPEE_CONNECTION_REPOSITORY } from './application/ports/shopee-connection-repository.port';
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
    ShopeeConnectionController,
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
    // Fase 4 (Publicar anúncio novo em marketplace, benchmark Tiny ERP) —
    // quarta/quinta capacidade do Mercado Livre (CATEGORY_DISCOVERY +
    // LISTING_CREATE), mesmo racional de MercadoLivreOrderProvider/
    // MercadoLivreAdsProvider: classe separada, reaproveita a MESMA conexão
    // OAuth2. Exportada abaixo para o futuro módulo marketplace-publishing.
    MercadoLivreListingProvider,
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

    // Integração Shopee Open Platform (27/07/2026) — mesmo racional
    // estrutural de MercadoLivreConnectionService/ApiClient acima, mas com
    // auth HMAC-SHA256 (type='API_KEY_HMAC') em vez de OAuth2 clássico.
    ShopeeApiClient,
    ShopeeConnectionService,
    // Diagnóstico read-only da conexão (GET /shop/get_shop_info) — mesmo
    // racional de MercadoLivreHandshakeService, classe separada de
    // ShopeeConnectionService.
    ShopeeHandshakeService,
    // Segunda capacidade da Shopee (ORDERS), depois do handshake de conexão
    // confirmado em produção (27/07/2026) — classe separada de
    // ShopeeConnectionService, mesmo racional de MercadoLivreOrderProvider.
    // Exportada abaixo para o módulo Orders registrar em
    // ORDER_CAPABLE_PROVIDERS.
    ShopeeOrderProvider,
    // Fase 4 (Publicar anúncio novo em marketplace, benchmark Tiny ERP) —
    // quarta/quinta capacidade da Shopee (CATEGORY_DISCOVERY +
    // LISTING_CREATE), mesmo racional de ShopeeOrderProvider: classe
    // separada, reaproveita a MESMA conexão. Exportada abaixo para o futuro
    // módulo marketplace-publishing.
    ShopeeListingProvider,
    { provide: SHOPEE_CONNECTION_REPOSITORY, useClass: PrismaShopeeConnectionRepository },
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
  // Reestruturação do sync ML (25-26/07/2026, ver README) — MercadoLivreApiClient
  // e MercadoLivreConnectionService agora também exportados: o novo
  // MercadoLivreShipmentEnrichmentJob mora no módulo Orders (mesmo racional
  // de MercadoLivreOrderProvider — OrdersModule importa este módulo, nunca o
  // contrário) e precisa das DUAS classes concretas para consultar
  // /shipments/{id} com um token válido, sem duplicar nenhuma lógica de
  // OAuth2/refresh já existente aqui.
  exports: [
    FEE_RULE_RESOLVER,
    PRICE_UPDATE_DISPATCHER,
    MercadoLivreOrderProvider,
    MercadoLivreAdsProvider,
    MercadoLivreListingProvider,
    MercadoLivreApiClient,
    MercadoLivreConnectionService,
    MercadoLivreListingProvider,
    // Shopee ORDERS — mesmo racional de MercadoLivreOrderProvider: OrdersModule
    // importa este módulo só para consumir esta classe já registrada aqui.
    ShopeeOrderProvider,
    // Fase 4 — futuro módulo marketplace-publishing importa este módulo só
    // para consumir estas duas classes já registradas aqui.
    ShopeeListingProvider,
  ],
})
export class MarketplaceIntelligenceModule {}
