// Módulo de Ads multicanal — Fase 1 (dashboard de leitura). Funções puras de
// domínio, mesma disciplina de order-margin.ts/margin-calculator.ts: nada
// aqui sabe de banco, HTTP ou tenant — só recebe números já agregados e
// devolve um resultado determinístico, 100% testável sem fake nenhum.
//
// Thresholds são PARÂMETROS, não constantes hardcoded soterradas — mesmo
// racional de PricingStrategist (a regra de negócio em si pode um dia virar
// configurável por tenant, via CatalogSettings/FinancialPolicy; começar com
// um valor-parâmetro em vez de um número mágico espalhado pelo código é o
// que torna essa evolução um non-event). Os DEFAULT_* abaixo são referência
// de mercado para um MVP sem tela de configuração ainda.
export const DEFAULT_ROAS_HEALTHY_THRESHOLD = 3;
export const DEFAULT_MIN_CLICKS_FOR_SIGNAL = 30;

export interface CampaignHealthThresholds {
  roasHealthy: number;
  minClicksForSignal: number;
}

export const DEFAULT_CAMPAIGN_HEALTH_THRESHOLDS: CampaignHealthThresholds = {
  roasHealthy: DEFAULT_ROAS_HEALTHY_THRESHOLD,
  minClicksForSignal: DEFAULT_MIN_CLICKS_FOR_SIGNAL,
};

export interface CampaignMetricsTotals {
  spend: number;
  revenueAds: number;
  clicks: number;
  impressions: number;
}

// Matriz de classificação inspirada na "BCG aplicada a Ads" (proposta
// original do usuário) — refinada em 4 estados, não 3, porque "pouco dado
// ainda" é uma situação genuinamente diferente de "custo perdido": uma
// campanha nova de 2 dias não deveria ser recomendada para pausa só por
// ainda não ter volume suficiente para o ROAS ser confiável.
export type CampaignHealthTier = 'ESTRELA' | 'PONTO_DE_ATENCAO' | 'CUSTO_PERDIDO' | 'SEM_DADOS';

export interface CampaignHealthResult {
  tier: CampaignHealthTier;
  recommendation: string;
}

// ROAS = receita atribuída ao anúncio / gasto. null (não zero) quando spend
// é 0 — "sem investimento" não é o mesmo que "investimento sem retorno", e
// zero fabricaria um número que não existe.
export function calculateRoas(totals: Pick<CampaignMetricsTotals, 'spend' | 'revenueAds'>): number | null {
  if (totals.spend <= 0) return null;
  return totals.revenueAds / totals.spend;
}

// TACOS = gasto total em ads / receita TOTAL do tenant no período (ads +
// orgânica). totalTenantRevenue vem de fora (ORDER_FINANCIALS_READER, a
// MESMA porta que já alimenta o DRE) — esta função nunca tenta descobrir
// "quanto foi vendido organicamente": nenhuma API de ads de marketplace
// entrega esse número de verdade, é sempre derivado da receita total menos a
// receita de ads, e mesmo essa subtração já é uma aproximação (atribuição
// não é perfeita). Ver docs/marketplace-ads-architecture.md, seção 4.
export function calculateTacos(adsSpend: number, totalTenantRevenue: number): number | null {
  if (totalTenantRevenue <= 0) return null;
  return adsSpend / totalTenantRevenue;
}

export function classifyCampaignHealth(
  totals: CampaignMetricsTotals,
  thresholds: CampaignHealthThresholds = DEFAULT_CAMPAIGN_HEALTH_THRESHOLDS,
): CampaignHealthResult {
  const roas = calculateRoas(totals);

  if (roas === null) {
    return { tier: 'SEM_DADOS', recommendation: 'Sem gasto registrado no período — nada a avaliar ainda.' };
  }

  const hasVolume = totals.clicks >= thresholds.minClicksForSignal;

  if (roas >= thresholds.roasHealthy && hasVolume) {
    return { tier: 'ESTRELA', recommendation: 'ROAS saudável com volume relevante — considere aumentar o orçamento.' };
  }
  if (roas < thresholds.roasHealthy && hasVolume) {
    return {
      tier: 'PONTO_DE_ATENCAO',
      recommendation: 'Volume alto mas ROAS abaixo do saudável — revise criativo/título antes de cortar o orçamento.',
    };
  }
  if (roas < thresholds.roasHealthy && !hasVolume) {
    return { tier: 'CUSTO_PERDIDO', recommendation: 'Baixo volume e ROAS ruim — candidata a pausar.' };
  }
  // roas >= healthy mas volume ainda baixo: sinal positivo, mas não confiável ainda.
  return {
    tier: 'PONTO_DE_ATENCAO',
    recommendation: 'ROAS parece saudável, mas o volume ainda é baixo para ter certeza — acompanhe mais alguns dias.',
  };
}

// --- Alertas inteligentes (Fase 2) ---
//
// Máquina de estado de 1 bit por campanha (o "último tier que gerou alerta",
// persistido em AdsCampaign.lastAlertedTier) para decidir se um novo ciclo de
// sync deve ALERTAR, RESETAR ou não fazer nada — sem isso, cada sync a cada
// 2h re-alertaria a MESMA campanha ruim indefinidamente (spam), ou pior,
// nunca re-alertaria se ela se recuperar e piorar de novo.
//
// Só CUSTO_PERDIDO é alert-worthy no MVP: é o único tier com recomendação
// acionável de "considere pausar" — ESTRELA/PONTO_DE_ATENCAO são informativos
// (aparecem no dashboard), não emergenciais. SEM_DADOS nunca alerta (dado
// insuficiente não é um problema, é uma campanha nova).
export type AlertAction = 'ALERT' | 'RESET' | 'NONE';

export function determineAlertAction(
  previousAlertedTier: CampaignHealthTier | null,
  currentTier: CampaignHealthTier,
): AlertAction {
  const isBad = currentTier === 'CUSTO_PERDIDO';
  const wasAlerted = previousAlertedTier === 'CUSTO_PERDIDO';

  if (isBad && !wasAlerted) return 'ALERT'; // degradou agora — primeira vez neste episódio
  if (!isBad && wasAlerted) return 'RESET'; // recuperou — limpa o estado para poder alertar de novo se piorar depois
  return 'NONE'; // continua bom (nunca alertado) ou continua ruim (já alertado, não repete)
}

// --- Automação de escrita (Fase 3 — Safety Lock) ---
//
// Único critério para SUGERIR (nunca aplicar sozinho) uma ação de pausa:
// a campanha está em CUSTO_PERDIDO. É a mesma condição que já dispara
// determineAlertAction === 'ALERT' — de propósito: a sugestão de ação nasce
// do MESMO evento que o alerta, nunca de uma segunda regra paralela. Quem
// decide se a ação é de fato aplicada nunca é esta função nem o alerta: é
// sempre o usuário, confirmando explicitamente (AdsActionDispatcherService).
export function shouldSuggestPauseAction(tier: CampaignHealthTier): boolean {
  return tier === 'CUSTO_PERDIDO';
}
