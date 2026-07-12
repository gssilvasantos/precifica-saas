import type { InsightSeverity } from './types';

export interface SeverityMeta {
  label: string;
  dotClass: string;
  textClass: string;
  badgeClass: string;
}

// OPORTUNIDADE usa o acento neon (é a categoria "vale agir agora, tem
// upside") — INFO/ATENCAO usam o semáforo já existente (ink/warning), sem
// introduzir uma paleta nova para o mesmo conceito.
export const SEVERITY_META: Record<InsightSeverity, SeverityMeta> = {
  INFO: { label: 'Info', dotClass: 'bg-ink-500', textClass: 'text-ink-700', badgeClass: 'bg-ink-300/40 text-ink-700' },
  ATENCAO: {
    label: 'Atenção',
    dotClass: 'bg-margin-warning',
    textClass: 'text-margin-warning',
    badgeClass: 'bg-margin-warning/15 text-margin-warning',
  },
  OPORTUNIDADE: {
    label: 'Oportunidade',
    dotClass: 'bg-neon',
    textClass: 'text-ink-900',
    badgeClass: 'bg-neon/15 text-ink-900',
  },
};
