import { Card, CardContent } from '../ui/card';
import { cn } from '../../lib/utils';

interface Props {
  label: string;
  value: string;
  caption?: string;
  highlight?: boolean; // acento neon — reservado para o KPI "hero" do card row
}

// Camada de Comando (Etapa 18) — cartão de KPI puro, sem lógica de busca.
// Migrado para o primitivo Card (token bg-card/border-border, resolve Light/
// Dark sozinho). `highlight` continua o único lugar que usa neon como
// destaque (anel + glow), nunca como fundo cheio.
export default function KpiCard({ label, value, caption, highlight }: Props) {
  return (
    <Card className={cn('transition', highlight && 'ring-1 ring-accent/60 shadow-neonGlow')}>
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 font-serif text-3xl font-semibold text-foreground">{value}</p>
        {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
      </CardContent>
    </Card>
  );
}
