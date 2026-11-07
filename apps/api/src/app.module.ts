import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './shared/prisma/prisma.module';
import { IdentityAccessModule } from './modules/identity-access/identity-access.module';
import { LogisticsIntelligenceModule } from './modules/logistics-intelligence/logistics-intelligence.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { MarketplaceIntelligenceModule } from './modules/marketplace-intelligence/marketplace-intelligence.module';
import { ErpIntegrationModule } from './modules/erp-integration/erp-integration.module';
import { PricingIntelligenceModule } from './modules/pricing-intelligence/pricing-intelligence.module';
import { CompetitionIntelligenceModule } from './modules/competition-intelligence/competition-intelligence.module';
import { FinancialIntelligenceModule } from './modules/financial-intelligence/financial-intelligence.module';
import { OrdersModule } from './modules/orders/orders.module';
import { LogisticsFulfillmentModule } from './modules/logistics-fulfillment/logistics-fulfillment.module';
import { PromotionIntelligenceModule } from './modules/promotion-intelligence/promotion-intelligence.module';
import { MarketplaceAdsModule } from './modules/marketplace-ads/marketplace-ads.module';
import { TaggingModule } from './modules/tagging/tagging.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { FiscalModule } from './modules/fiscal/fiscal.module';
import { MarketplacePublishingModule } from './modules/marketplace-publishing/marketplace-publishing.module';
import { ProductionModule } from './modules/production/production.module';
import { FreightShippingModule } from './modules/freight-shipping/freight-shipping.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { TaxIntelligenceModule } from './modules/tax-intelligence/tax-intelligence.module';
import { AppController } from './app.controller';
import { resolveStorageDriver } from './shared/config/storage-environment';

// Mesmo STORAGE_ROOT usado por LocalFileStorageService — mantido em um só
// lugar aqui porque é a raiz raramente muda; se algum dia isso incomodar,
// vira uma env var lida nos dois lugares.
const STORAGE_ROOT = process.env.ERP_STORAGE_ROOT ?? join(process.cwd(), 'storage', 'uploads');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate limiting global (20/10/2026, achado de auditoria de segurança —
    // nenhum endpoint de entrada tinha proteção contra brute-force/abuso; só
    // existia rate limiting para chamadas DE SAÍDA aos marketplaces, em
    // shared/rate-limiting/). Ver ADR em docs/decisions/0005-rate-limiting-throttler.md.
    // Limite padrão (aplicado a toda rota que não tiver @Throttle próprio):
    // 60 requisições / 60s por IP. Rotas mais sensíveis (login, signup) têm
    // limite mais restrito via @Throttle no próprio controller
    // (auth.controller.ts) — class-validator/ValidationPipe já rejeita corpo
    // malformado antes de chegar aqui, então o guard protege a aplicação do
    // volume de tentativas, não da forma de cada requisição.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    // Registrados uma única vez na raiz — EventEmitter2 e o scheduler de
    // @Cron ficam disponíveis para injeção em qualquer módulo sem reimportar.
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    // Serve os arquivos espelhados pelo ERP Integration (fotos de produto) em
    // /uploads/* — SÓ faz sentido com o adapter de disco local (Etapa 5). Em
    // produção (STORAGE_DRIVER=r2/NODE_ENV=production), os arquivos vão para
    // o R2 e são servidos pelo domínio público do bucket (R2_PUBLIC_BASE_URL)
    // — não pelo próprio servidor Nest, que no Render nem tem disco
    // persistente entre deploys. Ver docs/deploy-render-supabase-r2.md,
    // seção 3.
    ...(resolveStorageDriver() === 'local'
      ? [ServeStaticModule.forRoot({ rootPath: STORAGE_ROOT, serveRoot: '/uploads' })]
      : []),
    PrismaModule,
    IdentityAccessModule,
    LogisticsIntelligenceModule,
    CatalogModule,
    MarketplaceIntelligenceModule,
    ErpIntegrationModule,
    PricingIntelligenceModule,
    CompetitionIntelligenceModule,
    FinancialIntelligenceModule,
    OrdersModule,
    LogisticsFulfillmentModule,
    PromotionIntelligenceModule,
    MarketplaceAdsModule,
    TaggingModule,
    ProcurementModule,
    FiscalModule,
    MarketplacePublishingModule,
    ProductionModule,
    FreightShippingModule,
    SellersModule,
    TaxIntelligenceModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
