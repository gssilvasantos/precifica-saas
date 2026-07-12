// Eventos de domínio emitidos por este módulo via EventEmitter2 (mesmo
// mecanismo já usado em marketplace-intelligence — ver
// docs/marketplace-intelligence-architecture.md, seção 11). O nome do evento
// é uma string simples (convenção já em uso no projeto); o que ganhamos aqui
// é o TYPE do payload, documentado uma vez, para quem emite e quem assina.
//
// IMPORTANTE (a resposta à pergunta "como o Pricing Engine assina sem
// acoplamento"): quem escuta um destes eventos NÃO importa nada deste
// módulo — nem o token, nem a classe concreta. Só precisa saber o NOME do
// evento (as constantes abaixo) e o formato do payload (as interfaces
// abaixo), ambos importáveis de shared/contracts ou daqui sem trazer
// nenhuma dependência de infraestrutura junto. Ver exemplo real em
// modules/pricing-intelligence/application/competitor-signal.listener.ts.

export const COMPETITION_EVENTS = {
  PRICE_CHANGED: 'competition.price-changed',
  BUY_BOX_LOST: 'competition.buy-box-lost',
  NEW_COMPETITOR_DETECTED: 'competition.new-competitor-detected',
} as const;

interface CompetitionEventBase {
  tenantId: string;
  skuCode: string;
  detectedAt: Date;
}

// Emitido sempre que o melhor preço de concorrente para o SKU muda em
// relação à última leitura processada (CompetitiveOpportunity anterior).
export interface PriceChangedEvent extends CompetitionEventBase {
  previousBestPrice: number | null;
  newBestPrice: number;
  priceGapPct: number;
}

// Emitido quando o status de Buy Box do nosso produto passa de
// WINNING -> LOSING (ou de UNKNOWN -> LOSING, quando já existia comparação
// possível antes). Não dispara em UNKNOWN -> UNKNOWN nem em manutenção de WINNING.
export interface BuyBoxLostEvent extends CompetitionEventBase {
  bestCompetitorLabel: string;
  bestCompetitorPrice: number;
  ourPrice: number | null;
}

// Emitido quando o radar retorna um competitorLabel que não constava no
// snapshot anterior para aquele SKU — sinal de que um concorrente novo
// entrou a disputar aquele produto.
export interface NewCompetitorDetectedEvent extends CompetitionEventBase {
  competitorLabel: string;
  competitorPrice: number;
}
