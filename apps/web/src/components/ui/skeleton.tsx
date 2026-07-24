import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

// Placeholder de carregamento — substitui os textos soltos "Carregando…"
// espalhados pelas telas (ex.: DashboardPage.tsx) por um shimmer que já
// sugere a forma do conteúdo final, padrão que reduz a sensação de espera.
function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
