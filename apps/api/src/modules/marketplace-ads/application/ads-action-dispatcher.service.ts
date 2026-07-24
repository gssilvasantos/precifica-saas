import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ADS_ACTION_SUGGESTION_REPOSITORY,
  AdsActionSuggestionRepository,
  AdsActionSuggestionSummary,
} from './ports/ads-action-suggestion-repository.port';
import { AdsProviderRegistry } from './ads-provider-registry.service';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';
import { AdsActionCapableProvider, MarketplaceProvider, isAdsActionCapable } from '../../../shared/contracts/marketplace-provider.contract';
import { AppDataMode } from '../../../shared/contracts/order-financials-reader.port';

// Safety Lock (Fase 3) — o ÚNICO ponto do sistema que efetivamente chama uma
// ação de escrita (pauseCampaign) contra um marketplace, e SÓ chama depois
// de confirmação explícita do usuário (nunca automaticamente a partir de um
// alerta ou de um cron). Mesmo racional de PricingDecisionService.applyDecision
// (camada de aplicação como único ponto de disparo de um comando de
// escrita), com uma trava a mais: aqui a sugestão precisa já existir,
// PENDING, criada por AdsAlertingService — este serviço nunca decide "o
// quê" sugerir, só "se" e "quando" aplicar o que já foi sugerido.
@Injectable()
export class AdsActionDispatcherService {
  private readonly logger = new Logger(AdsActionDispatcherService.name);

  constructor(
    @Inject(ADS_ACTION_SUGGESTION_REPOSITORY) private readonly suggestions: AdsActionSuggestionRepository,
    private readonly registry: AdsProviderRegistry,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  async listPending(tenantId: string, dataMode?: AppDataMode): Promise<AdsActionSuggestionSummary[]> {
    return this.suggestions.listPending(tenantId, dataMode);
  }

  // O Safety Lock em si: só chega aqui depois de uma ação HTTP explícita do
  // usuário (POST .../confirm) — nunca chamado por um job ou listener.
  async confirmAndApply(tenantId: string, suggestionId: string, confirmedByUserId: string): Promise<AdsActionSuggestionSummary> {
    const suggestion = await this.requirePendingSuggestion(tenantId, suggestionId);

    // Marca CONFIRMED antes de chamar o provider — se a chamada de rede
    // falhar ou o processo cair no meio, o registro já reflete que o
    // usuário confirmou (nunca volta a aparecer como "aguardando decisão"
    // silenciosamente); a resolução final (APPLIED/FAILED) acontece logo
    // em seguida, na mesma chamada.
    await this.suggestions.updateStatus(suggestion.id, 'CONFIRMED', { resolvedByUserId: confirmedByUserId });

    // Anotado como MarketplaceProvider[] (não AdsCapableProvider[], o tipo
    // de retorno de findByMarketplaceCode) de propósito: isAdsActionCapable
    // é um type guard para AdsActionCapableProvider, um irmão de
    // AdsCapableProvider (os dois estendem só MarketplaceProvider, um não
    // estende o outro) — sem este widening, TS não consegue estreitar o
    // resultado de .find() para AdsActionCapableProvider.
    const providers: MarketplaceProvider[] = this.registry.findByMarketplaceCode(suggestion.channelCode);
    const provider = providers.find(isAdsActionCapable);
    if (!provider) {
      const message = `Nenhum provider de ${suggestion.channelCode} sabe executar ações de ads (ADS_ACTIONS) — ação não aplicada.`;
      await this.suggestions.updateStatus(suggestion.id, 'FAILED', { resolvedByUserId: confirmedByUserId, failureReason: message });
      this.emitFailureAlert(suggestion, message);
      return { ...suggestion, status: 'FAILED', failureReason: message, resolvedByUserId: confirmedByUserId, resolvedAt: new Date() };
    }

    const result = await this.applyAction(provider, tenantId, suggestion);

    if (result.success) {
      await this.suggestions.updateStatus(suggestion.id, 'APPLIED', { resolvedByUserId: confirmedByUserId });
      return { ...suggestion, status: 'APPLIED', resolvedByUserId: confirmedByUserId, resolvedAt: new Date() };
    }

    const failureReason = result.message ?? 'Provider devolveu falha sem mensagem.';
    await this.suggestions.updateStatus(suggestion.id, 'FAILED', { resolvedByUserId: confirmedByUserId, failureReason });
    this.emitFailureAlert(suggestion, failureReason);
    return { ...suggestion, status: 'FAILED', failureReason, resolvedByUserId: confirmedByUserId, resolvedAt: new Date() };
  }

  // Rejeitar é tão explícito quanto confirmar — mesma trava de auditoria
  // (resolvedByUserId), nunca aplica nada no provider.
  async reject(tenantId: string, suggestionId: string, rejectedByUserId: string): Promise<AdsActionSuggestionSummary> {
    const suggestion = await this.requirePendingSuggestion(tenantId, suggestionId);
    await this.suggestions.updateStatus(suggestion.id, 'REJECTED', { resolvedByUserId: rejectedByUserId });
    return { ...suggestion, status: 'REJECTED', resolvedByUserId: rejectedByUserId, resolvedAt: new Date() };
  }

  private async requirePendingSuggestion(tenantId: string, suggestionId: string): Promise<AdsActionSuggestionSummary> {
    const suggestion = await this.suggestions.findById(tenantId, suggestionId);
    if (!suggestion) {
      throw new Error(`Sugestão de ação ${suggestionId} não encontrada para o tenant ${tenantId}.`);
    }
    if (suggestion.status !== 'PENDING') {
      throw new Error(`Sugestão ${suggestionId} não está mais PENDING (status atual: ${suggestion.status}) — nada a fazer.`);
    }
    return suggestion;
  }

  private async applyAction(provider: AdsActionCapableProvider, tenantId: string, suggestion: AdsActionSuggestionSummary) {
    if (suggestion.actionType === 'PAUSE_CAMPAIGN') {
      return provider.pauseCampaign({ marketplaceCode: suggestion.channelCode, tenantId }, suggestion.externalCampaignId);
    }
    // Defensivo: hoje só existe PAUSE_CAMPAIGN no enum, mas se o schema
    // ganhar um tipo novo sem este switch ser atualizado, falha explícito
    // em vez de silenciosamente não fazer nada.
    throw new Error(`Tipo de ação desconhecido: ${suggestion.actionType}`);
  }

  private emitFailureAlert(suggestion: AdsActionSuggestionSummary, message: string): void {
    this.logger.error(`Falha ao aplicar ação ${suggestion.actionType} na campanha ${suggestion.externalCampaignId}: ${message}`);
    this.alerts.emitAlert({
      source: 'AdsActionDispatcherService',
      severity: 'ERROR',
      message: `Falha ao aplicar ação confirmada pelo usuário (${suggestion.actionType})`,
      context: {
        tenantId: suggestion.tenantId,
        suggestionId: suggestion.id,
        campaignId: suggestion.campaignId,
        externalCampaignId: suggestion.externalCampaignId,
        channelCode: suggestion.channelCode,
        error: message,
      },
    });
  }
}
