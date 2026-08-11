import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { TAX_RATE_RESOLVER } from '../../shared/contracts/tokens';
import { TaxRateResolverService } from './application/tax-rate-resolver.service';
import {
  PRODUCT_TAX_PROFILE_REPOSITORY,
  TENANT_PRIOR_REVENUE_REPOSITORY,
  TENANT_TAX_PROFILE_REPOSITORY,
} from './application/ports/tax-repositories.port';
import {
  PrismaProductTaxProfileRepository,
  PrismaTenantPriorRevenueRepository,
  PrismaTenantTaxProfileRepository,
} from './infrastructure/prisma-tax.repositories';
import { IdentityAccessModule } from '../identity-access/identity-access.module';
import { TenantTaxProfileController } from './interface/controllers/tenant-tax-profile.controller';
import { TenantTaxProfileService } from './application/tenant-tax-profile.service';

// Tax Intelligence (02/08/2026) — ver docs/tributacao-br-regimes-e-reforma.md.
//
// Bounded context próprio: resolve a ALÍQUOTA que entra no piso de preço e nas
// deduções do DRE. Distinto de `fiscal` (que emite NF-e) e de `catalog` (que
// cadastra produto).
//
// Importa OrdersModule só para consumir MONTHLY_REVENUE_READER — o RBT12 é a
// receita bruta dos 12 meses anteriores, e essa informação vive nos pedidos.
// Sempre pela porta, nunca pela classe OrdersService. Sem import circular:
// OrdersModule não conhece este módulo.
//
// Exporta apenas TAX_RATE_RESOLVER. Nenhum outro módulo deve conhecer os
// repositórios nem a tabela do Anexo I.
@Module({
  imports: [PrismaModule, OrdersModule, IdentityAccessModule],
  controllers: [TenantTaxProfileController],
  providers: [
    TenantTaxProfileService,
    TaxRateResolverService,
    { provide: TAX_RATE_RESOLVER, useExisting: TaxRateResolverService },
    { provide: TENANT_TAX_PROFILE_REPOSITORY, useClass: PrismaTenantTaxProfileRepository },
    { provide: PRODUCT_TAX_PROFILE_REPOSITORY, useClass: PrismaProductTaxProfileRepository },
    { provide: TENANT_PRIOR_REVENUE_REPOSITORY, useClass: PrismaTenantPriorRevenueRepository },
  ],
  exports: [TAX_RATE_RESOLVER],
})
export class TaxIntelligenceModule {}
