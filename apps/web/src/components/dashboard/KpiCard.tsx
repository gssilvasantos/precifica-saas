import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { cn } from '../../lib/utils';

interface Props {
  label: string;
  value: string;
  caption?: string;
  highlight?: boolean; // acento de marca — reservado para o KPI "hero" do card row
  icon?: LucideIcon;
  // Reestruturação Visual WowDash (13/10/2026) — chip de ícone colorido
  // (padrão do template: cada KPI tem um tom próprio, não todos iguais).
  // Vocabulário restrito de propósito aos tons já existentes na paleta
  // Kyneti (accent/good/warning/gold) — nenhuma cor nova introduzida.
  tone?: 'accent' | 'good' | 'warning' | 'gold';
}

const TONE_CLASSES: Record<NonNullable<Props['tone']>, string> = {
  accent: 'bg-accent/10 text-accent',
  good: 'bg-margin-good/10 text-margin-good',
  warning: 'bg-margin-warning/10 text-margin-warning',
  gold: 'bg-gold/10 text-gold',
};

// Cartão de KPI puro, sem lógica de busca. `highlight` continua o único
// lugar que usa o acento de marca como glow de destaque (ring + shadow),
// nunca como fundo cheio do cartão em si.
export default function KpiCard({ label, value, caption, highlight, icon: Icon, tone = 'accent' }: Props) {
  return (
    <Card className={cn('transition', highlight && 'ring-1 ring-accent/60 shadow-neonGlow')}>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
          {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
        </div>
        {Icon && (
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', TONE_CLASSES[tone])}>
            <Icon className="h-5 w-5" strokeWidth={1.8} />
          </span>
        )}
      </CardContent>
    </Card>
  );
}
