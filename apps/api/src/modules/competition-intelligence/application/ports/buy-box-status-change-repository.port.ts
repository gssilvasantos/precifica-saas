// CompetitiveOpportunityStatusChange — histórico append-only de TRANSIÇÕES
// de buyBoxStatus. Ver comentário na própria model (schema.prisma) e em
// domain/status-change-recorder.ts.

import { BuyBoxStatusValue } from '../../domain/status-change-recorder';

export interface BuyBoxStatusChangeRecord {
  id: string;
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

export interface BuyBoxStatusChangeCreateData {
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

export interface FindBuyBoxTransitionsFilter {
  tenantId: string;
  // Filtra pelo status PARA ONDE a transição foi (ex.: "LOSING" = só quem
  // passou a perder). Omitido = qualquer transição.
  newStatus?: BuyBoxStatusValue;
  skuCode?: string;
  detectedSince?: Date;
  limit: number; // teto obrigatório no servidor — ver .claude/rules/backend.md "Limites e proteção"
}

export interface BuyBoxStatusChangeRepository {
  create(data: BuyBoxStatusChangeCreateData): Promise<void>;
  findByTenant(filter: FindBuyBoxTransitionsFilter): Promise<BuyBoxStatusChangeRecord[]>;
  // Retenção (ADR-0004, 14/10/2026) — varredura de manutenção cruzando
  // todos os tenants por natureza (apaga por data, não por conta
  // específica), chamada só pelo job de limpeza em background
  // (BuyBoxStatusChangeRetentionCleanupJob). Retorna quantas linhas foram
  // apagadas, para o job logar.
  deleteOlderThan(cutoff: Date): Promise<number>;
}

export const BUY_BOX_STATUS_CHANGE_REPOSITORY = Symbol('BUY_BOX_STATUS_CHANGE_REPOSITORY');
