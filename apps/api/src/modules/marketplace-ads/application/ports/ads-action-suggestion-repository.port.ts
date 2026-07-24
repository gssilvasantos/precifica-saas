import { AppDataMode } from '../../../../shared/contracts/order-financials-reader.port';

// Fase 3 (automação de escrita — Safety Lock). Mesma disciplina de
// AdsCampaignRepository: DTO de leitura autocontido, não espelho 1:1 do
// model Prisma.
export type AdsActionType = 'PAUSE_CAMPAIGN';
export type AdsActionStatus = 'PENDING' | 'CONFIRMED' | 'APPLIED' | 'REJECTED' | 'FAILED';
// Fase 4 (sugestão via IA). Ver comentário no schema.prisma (enum
// AdsActionSource) — não muda o fluxo de aprovação/aplicação, só a origem.
export type AdsActionSource = 'RULE_BASED' | 'AI';

export interface AdsActionSuggestionSummary {
  id: string;
  tenantId: string;
  campaignId: string;
  externalCampaignId: string;
  campaignName: string;
  channelCode: string;
  actionType: AdsActionType;
  status: AdsActionStatus;
  reason: string;
  suggestedAt: Date;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  failureReason: string | null;
  source: AdsActionSource;
  confidenceScore: number | null;
  metadata: Record<string, unknown> | null;
}

// Campos extras da Fase 4 — omitidos = sugestão RULE_BASED (mesmo
// comportamento de sempre, é o @default(RULE_BASED) do schema; AdsAlertingService
// continua chamando createPending sem este parâmetro, nenhuma mudança nela).
export interface CreatePendingAiFields {
  source: 'AI';
  confidenceScore: number;
  metadata?: Record<string, unknown>;
}

export interface AdsActionSuggestionRepository {
  // Cria uma sugestão PENDING — chamado por AdsAlertingService (Fase 2, no
  // instante em que determineAlertAction decide 'ALERT') ou por
  // AdsAiOptimizationService (Fase 4, com aiFields preenchido). Mesmo
  // método para as duas origens — a única diferença é o parâmetro opcional.
  createPending(
    tenantId: string,
    campaignId: string,
    actionType: AdsActionType,
    reason: string,
    aiFields?: CreatePendingAiFields,
  ): Promise<string>;

  // Idempotência: existe alguma sugestão ainda não resolvida (PENDING ou
  // CONFIRMED) para esta campanha+ação? Evita empilhar uma sugestão nova a
  // cada ciclo de sync enquanto a anterior ainda não foi decidida pelo
  // usuário — AdsAlertingService só chama createPending se isto devolver null.
  findOpenSuggestion(campaignId: string, actionType: AdsActionType): Promise<AdsActionSuggestionSummary | null>;

  // dataMode omitido = 'REAL' (fail-safe, mesmo racional de OrderRepository):
  // sugestão isDemo (via campanha-pai) nunca aparece na fila real por
  // engano — filtro por join com AdsCampaign.isDemo, ver
  // PrismaAdsActionSuggestionRepository.
  listPending(tenantId: string, dataMode?: AppDataMode): Promise<AdsActionSuggestionSummary[]>;

  findById(tenantId: string, id: string): Promise<AdsActionSuggestionSummary | null>;

  // Transição de estado — status final (CONFIRMED é setado separadamente
  // pelo dispatcher antes de chamar o provider, ver AdsActionDispatcherService).
  updateStatus(
    id: string,
    status: AdsActionStatus,
    fields?: { resolvedByUserId?: string; failureReason?: string },
  ): Promise<void>;

  // Demo Mode — remove toda sugestão cuja campanha-pai é isDemo=true (não
  // existe campo isDemo direto nesta tabela, ver comentário no schema.prisma
  // sobre isDemo só em entidades-pai). Chamado pelo AdsAuditSeederService
  // ANTES de deleteDemoCampaigns, pela FK.
  deleteDemoSuggestions(tenantId: string): Promise<number>;
}

export const ADS_ACTION_SUGGESTION_REPOSITORY = Symbol('ADS_ACTION_SUGGESTION_REPOSITORY');
