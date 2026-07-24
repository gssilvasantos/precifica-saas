import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
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
import { AppController } from './app.controller';
import { resolveStorageDriver } from './shared/config/storage-environment';

// Mesmo STORAGE_ROOT usado por LocalFileStorageService — mantido em um só
// lugar aqui porque é a raiz raramente muda; se algum dia isso incomodar,
// vira uma env var lida nos dois lugares.
const STORAGE_ROOT = process.env.ERP_STORAGE_ROOT ?? join(process.cwd(), 'storage', 'uploads');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
  controllers: [AppController],
})
export class AppModule {}
