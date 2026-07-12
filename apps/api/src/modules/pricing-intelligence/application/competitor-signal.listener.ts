import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  COMPETITION_EVENTS,
  BuyBoxLostEvent,
  NewCompetitorDetectedEvent,
  PriceChangedEvent,
} from '../../competition-intelligence/domain/events/competition-events';
import { PricingDecisionService } from './pricing-decision.service';

// EXEMPLO CONCRETO de como o Pricing Engine "assina" os sinais do
// Competition Intelligence sem acoplamento — a resposta de código para a
// pergunta 1 do pedido. Repare no que este arquivo NÃO faz:
//
// - NÃO importa CompetitionIntelligenceModule (nem em pricing-intelligence.module.ts).
// - NÃO importa nenhuma classe de aplicação/infraestrutura daquele módulo
//   (nenhum service, nenhum repository, nenhum token de DI).
// - Importa só um arquivo de CONSTANTES + TIPOS (competition-events.ts) —
//   puro dado, zero I/O, zero classe injetável. É o "vocabulário do evento",
//   não uma dependência de runtime.
//
// O EventEmitter2 (global, registrado uma vez em AppModule) descobre este
// listener automaticamente porque a classe está registrada como provider em
// PricingIntelligenceModule — nenhum import extra de módulo é necessário
// para a assinatura funcionar. Se amanhã Competition Intelligence virar um
// serviço separado, só o transporte muda (evento in-process -> fila); este
// arquivo não muda uma linha.
//
// Atualização ("modo operação"): no BUY_BOX_LOST, o listener agora chama
// PricingDecisionService.decideAndMaybeApply() — calcula a decisão e só a
// APLICA de fato (via PRICE_UPDATE_DISPATCHER) se o produto tiver
// Product.autoRepricingEnabled = true. Continua log-only para os produtos
// que não ligaram a automação — nada muda para eles. O botão "Aplicar Preço
// Agora" (POST /pricing-intelligence/apply/:skuCode) é o caminho MANUAL
// equivalente, para quando a automação está desligada.
@Injectable()
export class CompetitorSignalListener {
  private readonly logger = new Logger(CompetitorSignalListener.name);

  constructor(private readonly pricingDecisions: PricingDecisionService) {}

  @OnEvent(COMPETITION_EVENTS.PRICE_CHANGED)
  handlePriceChanged(payload: PriceChangedEvent) {
    this.logger.log(
      `[sinal] Preço de concorrente mudou — SKU ${payload.skuCode} (tenant ${payload.tenantId}): ` +
        `${payload.previousBestPrice ?? 'sem leitura anterior'} -> ${payload.newBestPrice} ` +
        `(gap ${(payload.priceGapPct * 100).toFixed(1)}%). Sem reação automática configurada ainda.`,
    );
  }

  @OnEvent(COMPETITION_EVENTS.BUY_BOX_LOST)
  async handleBuyBoxLost(payload: BuyBoxLostEvent) {
    this.logger.warn(
      `[sinal] Buy Box perdido — SKU ${payload.skuCode} (tenant ${payload.tenantId}): ` +
        `concorrente "${payload.bestCompetitorLabel}" a ${payload.bestCompetitorPrice} vs. nosso preço ${payload.ourPrice ?? 'desconhecido'}.`,
    );

    try {
      const result = await this.pricingDecisions.decideAndMaybeApply(payload.tenantId, payload.skuCode);
      if (!result) {
        this.logger.warn(`[decisão] Não foi possível calcular decisão para SKU ${payload.skuCode} — dado insuficiente.`);
        return;
      }
      const { decision } = result;
      this.logger.log(
        `[decisão] SKU ${payload.skuCode}: ${decision.action} -> preço recomendado ${decision.recommendedPrice} ` +
          `(margem resultante ${decision.resultingMarginPct.toFixed(1)}%). ${decision.reason} ` +
          `${result.applied ? '[APLICADO]' : '[NÃO APLICADO]'} ${result.reason}`,
      );
    } catch (error) {
      this.logger.error(`Falha ao calcular/aplicar decisão de preço para SKU ${payload.skuCode}: ${(error as Error).message}`);
    }
  }

  @OnEvent(COMPETITION_EVENTS.NEW_COMPETITOR_DETECTED)
  handleNewCompetitorDetected(payload: NewCompetitorDetectedEvent) {
    this.logger.log(
      `[sinal] Novo concorrente na liderança de preço — SKU ${payload.skuCode} (tenant ${payload.tenantId}): ` +
        `"${payload.competitorLabel}" a ${payload.competitorPrice}.`,
    );
  }
}
