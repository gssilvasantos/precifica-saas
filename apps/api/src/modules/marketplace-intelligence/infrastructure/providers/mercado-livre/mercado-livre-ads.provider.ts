import { Injectable, Logger } from '@nestjs/common';
import {
  AdsActionCapableProvider,
  AdsActionResult,
  AdsCapableProvider,
  AuthenticatedProvider,
  FetchContext,
  ProviderCapability,
  ProviderHealthStatus,
  RawAdsCampaignCandidate,
  RawAdsMetricCandidate,
} from '../../../../../shared/contracts/marketplace-provider.contract';
import { MercadoLivreApiClient } from './mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../application/mercado-livre-connection.service';

// A API de métricas do Mercado Livre limita a janela de consulta a 90 dias
// (documentado publicamente) — validado aqui, não silenciosamente truncado.
const MAX_METRICS_WINDOW_DAYS = 90;

// Classe SEPARADA de MercadoLivreOrderProvider/MercadoLivreFeeRuleProvider —
// mesmo racional documentado nos outros dois adapters do canal: capacidades
// independentes, nada obriga viverem na mesma classe. Ads exige OAuth2 de
// vendedor (igual Orders), por isso injeta MercadoLivreConnectionService —
// diferente de MercadoLivreFeeRuleProvider, que usa endpoint público.
//
// Fase 3 (Safety Lock): também implementa AdsActionCapableProvider
// (pauseCampaign) — mesma classe, não uma terceira, porque a capacidade de
// escrita reaproveita EXATAMENTE a mesma resolução de advertiser_id/token da
// leitura (resolveAdvertiser). Quem decide QUANDO chamar pauseCampaign
// nunca é este provider: é AdsActionDispatcherService, só depois de
// confirmação explícita do usuário.
//
// Normalização defensiva: os nomes de campo abaixo (`pickString`/`pickNumber`
// com múltiplos candidatos) refletem a incerteza documentada em
// mercado-livre-api.client.ts sobre o shape exato da resposta — em vez de
// assumir um único nome de campo e falhar silenciosamente com `undefined`,
// tenta os candidatos mais prováveis (baseados na documentação pública) e
// lança erro explícito se nenhum bater, nunca inventa um valor.
@Injectable()
export class MercadoLivreAdsProvider implements AdsCapableProvider, AdsActionCapableProvider, AuthenticatedProvider {
  readonly code = 'MERCADO_LIVRE_ADS';
  readonly marketplaceCode = 'MERCADO_LIVRE';
  readonly sourceType = 'OFFICIAL_API' as const;
  readonly capabilities = [ProviderCapability.ADS, ProviderCapability.ADS_ACTIONS];
  readonly authScope = 'TENANT' as const;

  private readonly logger = new Logger(MercadoLivreAdsProvider.name);

  constructor(
    private readonly client: MercadoLivreApiClient,
    private readonly connection: MercadoLivreConnectionService,
  ) {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'UP' };
  }

  async listTenantIdsToSync(): Promise<string[]> {
    return this.connection.listActiveTenantIds();
  }

  async ensureValidCredentials(tenantId?: string): Promise<void> {
    await this.connection.getValidAccessToken(tenantId);
  }

  async fetchAdsCampaigns(ctx: FetchContext): Promise<RawAdsCampaignCandidate[]> {
    if (!ctx.tenantId) {
      this.logger.warn('MercadoLivreAdsProvider chamado sem tenantId — campanha de ads é sempre por vendedor.');
      return [];
    }
    const { accessToken, advertiserId } = await this.resolveAdvertiser(ctx.tenantId);
    if (!advertiserId) return [];

    const raw = await this.client.fetchAdsCampaigns(advertiserId, accessToken);
    return raw.map((c) => normalizeMlAdsCampaign(c));
  }

  async fetchAdsMetrics(ctx: FetchContext, dateFrom: Date, dateTo: Date): Promise<RawAdsMetricCandidate[]> {
    if (!ctx.tenantId) {
      this.logger.warn('MercadoLivreAdsProvider chamado sem tenantId — métrica de ads é sempre por vendedor.');
      return [];
    }
    const windowDays = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (24 * 60 * 60 * 1000));
    if (windowDays > MAX_METRICS_WINDOW_DAYS) {
      throw new Error(
        `Janela de métricas de ${windowDays} dias excede o limite de ${MAX_METRICS_WINDOW_DAYS} dias da API de Ads do Mercado Livre.`,
      );
    }

    const { accessToken, advertiserId } = await this.resolveAdvertiser(ctx.tenantId);
    if (!advertiserId) return [];

    const raw = await this.client.fetchAdsCampaignMetrics(advertiserId, accessToken, dateFrom, dateTo);
    return raw.map((m) => normalizeMlAdsMetric(m));
  }

  // Fase 3 — Safety Lock. Nunca chamado automaticamente: só
  // AdsActionDispatcherService chama isto, e só depois que o usuário
  // confirma explicitamente uma AdsActionSuggestion pendente.
  async pauseCampaign(ctx: FetchContext, externalCampaignId: string): Promise<AdsActionResult> {
    if (!ctx.tenantId) {
      return { success: false, message: 'Ação de ads sempre exige tenantId (é sempre por vendedor).' };
    }
    try {
      const { accessToken, advertiserId } = await this.resolveAdvertiser(ctx.tenantId);
      if (!advertiserId) {
        return { success: false, message: `Nenhum advertiser_id de Ads encontrado no Mercado Livre para o tenant ${ctx.tenantId}.` };
      }
      await this.client.pauseCampaign(advertiserId, accessToken, externalCampaignId);
      return { success: true };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  // advertiser_id não muda entre chamadas dentro do mesmo sync — resolvido
  // uma vez por chamada de fetchAdsCampaigns/fetchAdsMetrics/pauseCampaign
  // (sem cache entre chamadas de propósito, mesma simplicidade de
  // MercadoLivreOrderProvider.fetchOrders: o provider não guarda estado
  // entre invocações, só o AdsSyncOrchestrator/AdsActionDispatcherService
  // decidem a cadência).
  private async resolveAdvertiser(tenantId: string): Promise<{ accessToken: string; advertiserId: string | null }> {
    const accessToken = await this.connection.getValidAccessToken(tenantId);
    const advertiserId = await this.client.fetchAdvertiserId(accessToken);
    if (!advertiserId) {
      this.logger.warn(`Tenant ${tenantId}: nenhum advertiser_id de Ads encontrado no Mercado Livre — pulando sync de ads.`);
    }
    return { accessToken, advertiserId };
  }
}

function pickString(raw: Record<string, unknown>, candidates: string[]): string | null {
  for (const key of candidates) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function pickNumber(raw: Record<string, unknown>, candidates: string[]): number | null {
  for (const key of candidates) {
    const value = raw[key];
    if (typeof value === 'number' && !Number.isNaN(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  }
  return null;
}

function normalizeMlAdsCampaign(raw: unknown): RawAdsCampaignCandidate {
  const record = raw as Record<string, unknown>;
  const externalCampaignId = pickString(record, ['id', 'campaign_id']);
  if (!externalCampaignId) {
    throw new Error(`Campanha de Ads do Mercado Livre sem id reconhecível: ${JSON.stringify(raw)}`);
  }
  const name = pickString(record, ['name']) ?? `Campanha ${externalCampaignId}`;
  const statusRaw = (pickString(record, ['status']) ?? '').toLowerCase();
  const status = mapMlCampaignStatus(statusRaw);
  const dailyBudget = pickNumber(record, ['budget', 'daily_budget']);

  return { externalCampaignId, name, status, dailyBudget };
}

function mapMlCampaignStatus(raw: string): RawAdsCampaignCandidate['status'] {
  if (raw === 'active') return 'ACTIVE';
  if (raw === 'paused') return 'PAUSED';
  if (raw === 'ended' || raw === 'finished') return 'ENDED';
  return 'UNKNOWN';
}

function normalizeMlAdsMetric(raw: unknown): RawAdsMetricCandidate {
  const record = raw as Record<string, unknown>;
  const externalCampaignId = pickString(record, ['campaign_id', 'id']);
  const periodDateRaw = pickString(record, ['date']);
  if (!externalCampaignId || !periodDateRaw) {
    throw new Error(`Métrica de Ads do Mercado Livre sem campaign_id/date reconhecível: ${JSON.stringify(raw)}`);
  }

  return {
    externalCampaignId,
    periodDate: new Date(periodDateRaw),
    spend: pickNumber(record, ['cost', 'spend']) ?? 0,
    revenueAds: pickNumber(record, ['direct_amount', 'total_amount', 'amount']) ?? 0,
    clicks: pickNumber(record, ['clicks']) ?? 0,
    impressions: pickNumber(record, ['prints', 'impressions']) ?? 0,
  };
}
