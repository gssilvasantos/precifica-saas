import { Module } from '@nestjs/common';
import { LogisticsSettingsService } from './application/logistics-settings.service';
import { ShippingWeightCalculatorService } from './application/shipping-weight-calculator.service';
import { PrismaLogisticsSettingsRepository } from './infrastructure/prisma-logistics-settings.repository';
import { LOGISTICS_SETTINGS_REPOSITORY } from './application/ports/logistics-settings-repository.port';
import { LogisticsSettingsController } from './interface/controllers/logistics-settings.controller';
import { SHIPPING_WEIGHT_CALCULATOR } from '../../shared/contracts/tokens';

@Module({
  controllers: [LogisticsSettingsController],
  providers: [
    LogisticsSettingsService,
    ShippingWeightCalculatorService,
    { provide: LOGISTICS_SETTINGS_REPOSITORY, useClass: PrismaLogisticsSettingsRepository },
    { provide: SHIPPING_WEIGHT_CALCULATOR, useClass: ShippingWeightCalculatorService },
  ],
  // Exporta a PORTA (o token), nunca a classe concreta — quem consome
  // (Catalog) só conhece o contrato definido em shared/contracts.
  exports: [SHIPPING_WEIGHT_CALCULATOR],
})
export class LogisticsIntelligenceModule {}
