import { Inject, Injectable } from '@nestjs/common';
import {
  LOGISTICS_SETTINGS_REPOSITORY,
  LogisticsSettingsRepository,
} from './ports/logistics-settings-repository.port';

// Padrão de referência comum em transporte aéreo/Correios no Brasil.
// Transportadoras rodoviárias costumam usar fator diferente — por isso é
// configurável por tenant, não uma constante fixa no código.
const DEFAULT_CUBIC_WEIGHT_FACTOR = 6000;

@Injectable()
export class LogisticsSettingsService {
  constructor(
    @Inject(LOGISTICS_SETTINGS_REPOSITORY) private readonly settings: LogisticsSettingsRepository,
  ) {}

  async getCubicWeightFactor(tenantId: string): Promise<number> {
    const record = await this.settings.findByTenant(tenantId);
    return record?.cubicWeightFactor ?? DEFAULT_CUBIC_WEIGHT_FACTOR;
  }

  updateCubicWeightFactor(tenantId: string, cubicWeightFactor: number) {
    return this.settings.upsert(tenantId, cubicWeightFactor);
  }
}
