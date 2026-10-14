// Lógica de domínio pura — decide SE uma leitura processada de
// CompetitiveOpportunity vira um registro de transição em
// CompetitiveOpportunityStatusChange. Sem I/O, sem Prisma, sem NestJS —
// mesmo racional de opportunity-calculator.ts.
//
// Por que existe separado do orquestrador: é a REGRA ("o que conta como
// transição digna de registro") — regra de negócio pura não fica escondida
// em serviço de aplicação nem em controller (CLAUDE.md raiz, princípio 3,
// e .claude/rules/backend.md "Serviços e domínio").

import { OpportunityResult } from './opportunity-calculator';

export type BuyBoxStatusValue = OpportunityResult['buyBoxStatus'];

export interface StatusChangeInput {
  tenantId: string;
  skuCode: string;
  channelCode: string | null;
  // null = nenhuma leitura anterior processada para este SKU ainda (CompetitiveOpportunity não existia).
  previousStatus: BuyBoxStatusValue | null;
  result: OpportunityResult;
  ourPrice: number | null;
  detectedAt: Date;
}

export interface StatusChangeRecord {
  tenantId: string;
  skuCode: string;
  channelCode: string | null;
  previousStatus: BuyBoxStatusValue | null;
  newStatus: BuyBoxStatusValue;
  ourPrice: number | null;
  bestCompetitorPrice: number;
  bestCompetitorLabel: string;
  priceGapPct: number;
  rank: number | null;
  detectedAt: Date;
}

// Regra: só é transição digna de registro quando o status muda de fato
// (incluindo a primeira leitura processável, previousStatus null -> algo —
// é a origem da série temporal daquele SKU). Manutenção do mesmo status
// (WINNING -> WINNING, LOSING -> LOSING, UNKNOWN -> UNKNOWN) não gera linha.
export function buildStatusChangeRecord(input: StatusChangeInput): StatusChangeRecord | null {
  if (input.previousStatus === input.result.buyBoxStatus) return null;

  return {
    tenantId: input.tenantId,
    skuCode: input.skuCode,
    channelCode: input.channelCode,
    previousStatus: input.previousStatus,
    newStatus: input.result.buyBoxStatus,
    ourPrice: input.ourPrice,
    bestCompetitorPrice: input.result.bestCompetitorPrice,
    bestCompetitorLabel: input.result.bestCompetitorLabel,
    priceGapPct: input.result.priceGapPct,
    rank: input.result.rank,
    detectedAt: input.detectedAt,
  };
}
