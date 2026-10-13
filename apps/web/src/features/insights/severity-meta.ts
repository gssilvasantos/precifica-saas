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
  INFO: {
    label: 'Info',
    dotClass: 'bg-muted-foreground',
    textClass: 'text-foreground/80',
    badgeClass: 'bg-muted text-foreground/80',
  },
  ATENCAO: {
    label: 'Atenção',
    dotClass: 'bg-margin-warning',
    textClass: 'text-margin-warning',
    badgeClass: 'bg-margin-warning/15 text-margin-warning',
  },
  OPORTUNIDADE: {
    label: 'Oportunidade',
    dotClass: 'bg-accent',
    textClass: 'text-foreground',
    badgeClass: 'bg-accent/15 text-foreground',
  },
};
