import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Helper padrão shadcn/ui: combina classes condicionais (clsx) e resolve
// conflitos de utilitário Tailwind (tailwind-merge — ex.: `cn('px-2', 'px-4')`
// vira só `px-4`, não os dois empilhados). Usado por todo componente em
// src/components/ui/*.tsx para aceitar um `className` extra do chamador sem
// duplicar/entrar em conflito com as classes internas do componente.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
