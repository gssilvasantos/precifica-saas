import { RawAdsCampaignCandidate, RawAdsMetricCandidate } from '../../../../shared/contracts/marketplace-provider.contract';
import { CampaignHealthTier } from '../../domain/ads-metrics';
import { AppDataMode } from '../../../../shared/contracts/order-financials-reader.port';

// DTO de leitura — mesma disciplina de OrderFinancialLine/ProductCatalogSummary:
// autocontido, não um espelho 1:1 do model Prisma (o consumidor não precisa
// saber de `AdsCampaignStatus` enum do Prisma nem de `Decimal`).
export interface AdsCampaignSummary {
  id: string; // id interno (uuid), não o externalCampaignId do canal
  channelCode: string;
  externalCampaignId: string;
  name: string;
  status: string;
  dailyBudget: number | null;
  lastSyncedAt: Date;
  // Estado de alerta (Fase 2) — o último tier que gerou um alerta emitido
  // para esta campanha, ou null se nunca alertou (ou se já se recuperou e o
  // estado foi limpo). Ver domain/ads-metrics.ts, determineAlertAction, para
  // a máquina de estado completa; AdsAlertingService é o único consumidor.
  lastAlertedTier: CampaignHealthTier | null;
  lastAlertedAt: Date | null;
}

export interface AdsCampaignMetricTotals {
  campaignId: string;
  spend: number;
  revenueAds: number;
  clicks: number;
  impressions: number;
}

// Payload de seed do Demo Mode (AdsAuditSeederService, nunca um provider real
// — mesmo racional de OrderUpsertData.isDemo, mas aqui como formato dedicado
// em vez de reaproveitar RawAdsCampaignCandidate: aquele tipo é o contrato
// compartilhado com QUALQUER AdsCapableProvider real, e misturar um conceito
// de Demo Mode nele arriscaria um adapter real setar isDemo por engano — a
// ausência do campo no tipo real é a garantia, não uma checagem em runtime).
export interface SeedDemoCampaignData {
  channelCode: string;
  externalCampaignId: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED' | 'UNKNOWN';
  dailyBudget: number | null;
}

export interface SeedDemoMetricData {
  periodDate: Date;
  spend: number;
  revenueAds: number;
  clicks: number;
  impressions: number;
}

export interface AdsCampaignRepository {
  // Upsert por (tenantId, channelCode, externalCampaignId) — mesma chave de
  // idempotência de Order (tenantId, channelCode, externalOrderId). Devolve
  // o id INTERNO (uuid), necessário para o upsert de AdsMetricSnapshot
  // (que referencia AdsCampaign pela FK, não pelo externalCampaignId).
  upsertCampaign(tenantId: string, channelCode: string, data: RawAdsCampaignCandidate): Promise<string>;

  // Upsert por (campaignId interno, periodDate) — granularidade diária, ver
  // schema.prisma (AdsMetricSnapshot).
  upsertMetricSnapshot(tenantId: string, campaignId: string, data: RawAdsMetricCandidate): Promise<void>;

  // dataMode omitido = 'REAL' (fail-safe, mesmo racional de OrderRepository):
  // quem esquece de passar dataMode nunca vê campanha de demonstração.
  listCampaigns(tenantId: string, channelCode?: string, dataMode?: AppDataMode): Promise<AdsCampaignSummary[]>;

  // Soma de métricas por campanha num período — a fonte do dashboard
  // (AdsInsightsService calcula ROAS por campanha em cima disso, e soma tudo
  // para o TACOS agregado do tenant).
  sumMetricsByCampaign(tenantId: string, dateFrom: Date, dateTo: Date, dataMode?: AppDataMode): Promise<AdsCampaignMetricTotals[]>;

  // Persiste o resultado de determineAlertAction (Fase 2) — tier=null,
  // alertedAt=null representa "nunca alertado ou já recuperado" (RESET);
  // tier preenchido representa "alertado por último neste tier" (ALERT).
  // Único consumidor: AdsAlertingService, logo após emitir (ou não) o alerta.
  updateAlertState(campaignId: string, tier: CampaignHealthTier | null, alertedAt: Date | null): Promise<void>;

  // --- Demo Mode (AdsAuditSeederService, seção "Audit Mode" do módulo) ---
  // Upsert por (tenantId, channelCode, externalCampaignId) igual a
  // upsertCampaign, mas grava isDemo=true — chave de negócio fixa garante
  // idempotência: rodar seed() de novo só atualiza as mesmas campanhas.
  seedDemoCampaign(tenantId: string, data: SeedDemoCampaignData): Promise<string>;
  seedDemoMetricSnapshot(tenantId: string, campaignId: string, data: SeedDemoMetricData): Promise<void>;
  // Remove TODA campanha isDemo=true do tenant (e, em cascata, suas métricas
  // — sugestões demo são removidas à parte, ver AdsActionSuggestionRepository).
  // WHERE isDemo=true explícito na implementação — nunca toca campanha real.
  deleteDemoCampaigns(tenantId: string): Promise<number>;
  countDemoCampaigns(tenantId: string): Promise<number>;
}

export const ADS_CAMPAIGN_REPOSITORY = Symbol('ADS_CAMPAIGN_REPOSITORY');
