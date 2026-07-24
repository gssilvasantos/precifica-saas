import type { CampaignHealthTier } from './api';

export interface TierMeta {
  label: string;
  dotClass: string;
  textClass: string;
  badgeClass: string;
  cardClass: string; // acento na borda do card da campanha
}

// Mesmo racional de SEVERITY_META (features/insights/severity-meta.ts):
// ESTRELA usa o dourado (mesmo tom já reservado para "melhor margem" no
// resto do produto — aqui significa "melhor campanha"); PONTO_DE_ATENCAO/
// CUSTO_PERDIDO reaproveitam o semáforo margin-warning/margin-danger que já
// existe; SEM_DADOS fica neutro (ink), nunca alarmante — campanha nova não
// é um problema.
export const TIER_META: Record<CampaignHealthTier, TierMeta> = {
  ESTRELA: {
    label: 'Estrela',
    dotClass: 'bg-gold',
    textClass: 'text-gold',
    badgeClass: 'bg-gold/15 text-gold',
    cardClass: 'ring-1 ring-gold/50',
  },
  PONTO_DE_ATENCAO: {
    label: 'Ponto de atenção',
    dotClass: 'bg-margin-warning',
    textClass: 'text-margin-warning',
    badgeClass: 'bg-margin-warning/15 text-margin-warning',
    cardClass: '',
  },
  CUSTO_PERDIDO: {
    label: 'Custo perdido',
    dotClass: 'bg-margin-danger',
    textClass: 'text-margin-danger',
    badgeClass: 'bg-margin-danger/15 text-margin-danger',
    cardClass: 'ring-1 ring-margin-danger/40',
  },
  SEM_DADOS: {
    label: 'Sem dados',
    dotClass: 'bg-ink-300',
    textClass: 'text-ink-500',
    badgeClass: 'bg-ink-300/40 text-ink-500',
    cardClass: '',
  },
};
