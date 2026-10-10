import { Module } from '@nestjs/common';
import { PromotionCampaignService } from './application/promotion-campaign.service';
import { PromotionIntelligenceService } from './application/promotion-intelligence.service';

import { PrismaPromotionCampaignRepository } from './infrastructure/prisma-promotion-campaign.repository';
import { PrismaPromotionEnrollmentRepository } from './infrastructure/prisma-promotion-enrollment.repository';

import { PromotionCampaignsController } from './interface/controllers/promotion-campaigns.controller';
import { MlCatalogCampaignsController } from './interface/controllers/ml-catalog-campaigns.controller';
import { MlCatalogCampaignService } from './application/ml-catalog-campaign.service';
import { MlCatalogListingCreationController } from './interface/controllers/ml-catalog-listing-creation.controller';
import { MlCatalogListingCreationService } from './application/ml-catalog-listing-creation.service';

import { PROMOTION_CAMPAIGN_REPOSITORY } from './application/ports/promotion-campaign-repository.port';
import { PROMOTION_ENROLLMENT_REPOSITORY } from './application/ports/promotion-enrollment-repository.port';

import { CatalogModule } from '../catalog/catalog.module';
import { MarketplaceIntelligenceModule } from '../marketplace-intelligence/marketplace-intelligence.module';
import { LogisticsFulfillmentModule } from '../logistics-fulfillment/logistics-fulfillment.module';
// Alíquota por produto para o planejador Buy Box + Campanhas (07/10/2026).
import { TaxIntelligenceModule } from '../tax-intelligence/public-api';

// "Motor de Cálculo de Margem" para promoções (Sprint 26) — ver
// docs/promotion-intelligence-architecture.md. Bounded context PRÓPRIO:
// valida a viabilidade de uma promoção ANTES dela existir de verdade.
//
// Importa CatalogModule (PRODUCT_CATALOG_READER + FINANCIAL_POLICY_READER),
// MarketplaceIntelligenceModule (FEE_RULE_RESOLVER) e
// LogisticsFulfillmentModule (LOGISTICS_COST_READER) — SEMPRE pela porta,
// nunca pela classe concreta. Deliberadamente NÃO cria uma
// "ConfiguracaoCanal" própria: taxa/comissão já vem de MarketplaceRule,
// política fiscal já vem de CatalogSettings — duplicar qualquer um dos
// dois aqui criaria duas fontes da verdade divergentes. Sem dependência
// circular: nenhum dos três módulos importados conhece este de volta.
@Module({
  imports: [CatalogModule, MarketplaceIntelligenceModule, LogisticsFulfillmentModule, TaxIntelligenceModule],
  controllers: [PromotionCampaignsController, MlCatalogCampaignsController, MlCatalogListingCreationController],
  providers: [
    PromotionCampaignService,
    PromotionIntelligenceService,
    MlCatalogCampaignService,
    MlCatalogListingCreationService,

    { provide: PROMOTION_CAMPAIGN_REPOSITORY, useClass: PrismaPromotionCampaignRepository },
    { provide: PROMOTION_ENROLLMENT_REPOSITORY, useClass: PrismaPromotionEnrollmentRepository },
  ],
})
export class PromotionIntelligenceModule {}
