export interface LogisticsSettings {
  tenantId: string;
  cubicWeightFactor: number;
}

export interface LogisticsSettingsRepository {
  findByTenant(tenantId: string): Promise<LogisticsSettings | null>;
  upsert(tenantId: string, cubicWeightFactor: number): Promise<LogisticsSettings>;
}

export const LOGISTICS_SETTINGS_REPOSITORY = Symbol('LOGISTICS_SETTINGS_REPOSITORY');
