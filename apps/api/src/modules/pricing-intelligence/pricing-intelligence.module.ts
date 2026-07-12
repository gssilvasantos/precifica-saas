import { Module } from '@nestjs/common';
import { NuvemshopMarginSimulatorService } from './application/nuvemshop-margin-simulator.service';
import { CompetitorSignalListener } from './application/competitor-signal.listener';
import { PackagingCostChangeListener } from './application/packaging-cost-change.listener';
import { PricingDecisionService } from './application/pricing-decision.service';
import { DefaultPricingStrategist } from './domain/default-pricing-strategist';
import { PRICING_STRATEGIST } from './domain/pricing-strategist';
import { NuvemshopMarginSimulatorController } from './interface/controllers/nuvemshop-margin-simulator.controller';
import { PricingDecisionController } from './interface/controllers/pricing-decision.controller';
import { ApplyPricingDecisionController } from './interface/controllers/apply-pricing-decision.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';
import { MarketplaceIntelligenceModule } from '../marketplace-intelligence/marketplace-intelligence.module';
import { CompetitionIntelligenceModule } from '../competition-intelligence/competition-intelligence.module';

// Primeira fatia do Pricing Intelligence (README, Etapa 5) — o simulador de
// margem da Nuvemshop — mais o PricingStrategist (núcleo de decisão de
// preço, ver domain/pricing-strategist.ts). Depende de portas externas,
// sempre via contrato, nunca tabela direta: PRODUCT_CATALOG_READER e
// FINANCIAL_POLICY_READER (Catalog — este último é a governança financeira
// do tenant, imposto + margem líquida mínima global, ver seção 8 do doc de
// arquitetura), CHANNEL_LISTING_READER (erp-integration), FEE_RULE_RESOLVER e
// PRICE_UPDATE_DISPATCHER (Marketplace Intelligence — este último é o que
// PricingDecisionService.applyDecision/decideAndMaybeApply chamam para
// aplicar de fato um preço, "modo operação"), COMPETITOR_SNAPSHOT_READER
// (Competition Intelligence) e PACKAGING_LINKED_PRODUCTS_READER (Catalog —
// consumida só por PackagingCostChangeListener, para achar quais SKUs
// reprecificar quando o custo de uma embalagem muda; ver seção 9 do doc de
// arquitetura).
//
// Nuance importante sobre acoplamento: CompetitionIntelligenceModule
// PRECISA estar nos imports abaixo — mas só porque PricingDecisionService
// consome a porta COMPETITOR_SNAPSHOT_READER (leitura síncrona sob demanda,
// igual a qualquer outra porta deste arquivo). Isso é diferente da
// assinatura de EVENTOS: CompetitorSignalListener continua sem importar
// nada de Competition Intelligence além do arquivo de constantes/tipos
// (competition-events.ts) — reagir a um evento nunca exigiu import de
// módulo; consumir uma porta síncrona sempre exigiu (mesma regra do resto
// da plataforma, ver docs/platform-architecture.md, seção 3).
@Module({
  imports: [CatalogModule, ErpIntegrationModule, MarketplaceIntelligenceModule, CompetitionIntelligenceModule],
  controllers: [NuvemshopMarginSimulatorController, PricingDecisionController, ApplyPricingDecisionController],
  providers: [
    NuvemshopMarginSimulatorService,
    CompetitorSignalListener,
    PackagingCostChangeListener,
    PricingDecisionService,
    DefaultPricingStrategist,
    // Binding trocável: outra estratégia (agressiva, conservadora, orientada
    // por IA) implementando PricingStrategist entra aqui, sem tocar em
    // PricingDecisionService nem no CompetitorSignalListener.
    { provide: PRICING_STRATEGIST, useExisting: DefaultPricingStrategist },
  ],
})
export class PricingIntelligenceModule {}
