import { Injectable } from '@nestjs/common';
import {
  PackageWeightInput,
  PackageWeightResult,
  ShippingWeightCalculator,
} from '../../../shared/contracts/shipping-weight-calculator.port';
import { LogisticsSettingsService } from './logistics-settings.service';
import { calculatePackageWeights } from '../domain/package-weight-calculator';

// Implementação da porta consumida pelo Catalog (ver shared/contracts). É a
// única classe do sistema que sabe que peso cubado depende de um fator
// configurável — o Catalog só enxerga o resultado já calculado.
@Injectable()
export class ShippingWeightCalculatorService implements ShippingWeightCalculator {
  constructor(private readonly logisticsSettings: LogisticsSettingsService) {}

  async calculate(tenantId: string, input: PackageWeightInput): Promise<PackageWeightResult> {
    const cubicWeightFactor = await this.logisticsSettings.getCubicWeightFactor(tenantId);
    return calculatePackageWeights({ ...input, cubicWeightFactor });
  }
}
