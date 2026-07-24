import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        // Uso: indicadores "ao vivo"/"inteligência" — mesmo racional do
        // Button variant="accent", reservado para poucos casos de destaque
        // real (Modo Demonstração, sugestão de IA), nunca status neutro.
        accent: 'border-accent/40 bg-accent/10 text-accent',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'border-border text-foreground',
        // Semáforo de margem (paleta `margin` já existente) — badges de
        // status de preço/margem em telas de Catálogo/MAP/Promoções.
        success: 'border-transparent bg-margin-good/15 text-margin-good',
        warning: 'border-transparent bg-margin-warning/15 text-margin-warning',
        danger: 'border-transparent bg-margin-danger/15 text-margin-danger',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
