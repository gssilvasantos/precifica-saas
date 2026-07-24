import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CATALOG_SETTINGS_REPOSITORY,
  CatalogSettingsRepository,
} from './ports/catalog-settings-repository.port';
import { CATALOG_SETTINGS_EVENTS } from '../domain/catalog-settings-events';

// Defaults confirmados com o usuário para produtos recém-importados do ERP
// (o Olist não tem conceito de margem desejada/mínima) — mesmo padrão do
// LogisticsSettingsService.DEFAULT_CUBIC_WEIGHT_FACTOR: valor de sistema
// sensato, configurável por tenant sem precisar de deploy.
const DEFAULT_DESIRED_MARGIN_PCT = 20;
const DEFAULT_MINIMUM_MARGIN_PCT = 8;

// Governança financeira: 0 até o tenant configurar (nunca inventa um piso
// que ninguém pediu) — ver comentário no schema.prisma.
const DEFAULT_TAX_RATE_PCT = 0;
const DEFAULT_MIN_PROFIT_MARGIN_PCT = 0;

@Injectable()
export class CatalogSettingsService {
  constructor(
    @Inject(CATALOG_SETTINGS_REPOSITORY) private readonly settings: CatalogSettingsRepository,
    private readonly events: EventEmitter2,
  ) {}

  async getDefaultMargins(tenantId: string): Promise<{ desiredMarginPct: number; minimumMarginPct: number }> {
    const record = await this.settings.findByTenant(tenantId);
    return {
      desiredMarginPct: record?.defaultDesiredMarginPct ?? DEFAULT_DESIRED_MARGIN_PCT,
      minimumMarginPct: record?.defaultMinimumMarginPct ?? DEFAULT_MINIMUM_MARGIN_PCT,
    };
  }

  updateDefaultMargins(tenantId: string, desiredMarginPct: number, minimumMarginPct: number) {
    return this.settings.upsertMargins(tenantId, desiredMarginPct, minimumMarginPct);
  }

  // Consumido por FinancialPolicyReaderService (Pricing Intelligence, via a
  // porta shared/contracts/financial-policy-reader.port.ts) — não por
  // controller HTTP diretamente (ver CatalogSettingsController para a rota
  // GET equivalente).
  //
  // targetRoas sai CRU aqui (number | null, sem fallback) — quem resolve
  // para DEFAULT_TARGET_ROAS quando o tenant não configurou é
  // FinancialPolicyReaderService (shared/contracts/financial-policy-reader.port.ts),
  // nunca este método: mesma disciplina de "o dado bruto e a política
  // resolvida são coisas diferentes" já usada para taxRatePct/minProfitMarginPct
  // (0 por padrão) vs. a fração que o Pricing Intelligence de fato consome.
  async getFinancialPolicy(
    tenantId: string,
  ): Promise<{ taxRatePct: number; minProfitMarginPct: number; targetRoas: number | null }> {
    const record = await this.settings.findByTenant(tenantId);
    return {
      taxRatePct: record?.taxRatePct ?? DEFAULT_TAX_RATE_PCT,
      minProfitMarginPct: record?.minProfitMarginPct ?? DEFAULT_MIN_PROFIT_MARGIN_PCT,
      targetRoas: record?.targetRoas ?? null,
    };
  }

  async updateFinancialPolicy(tenantId: string, taxRatePct: number, minProfitMarginPct: number, targetRoas?: number) {
    const result = await this.settings.upsertFinancialPolicy(tenantId, taxRatePct, minProfitMarginPct, targetRoas);
    // Avisa quem cacheia (FinancialPolicyReaderService) que o valor mudou —
    // sem isso, a mudança só valeria depois do TTL do cache expirar (ver
    // seção 8 do doc de arquitetura para o racional de ter um cache aqui).
    this.events.emit(CATALOG_SETTINGS_EVENTS.FINANCIAL_POLICY_UPDATED, { tenantId });
    return result;
  }
}
