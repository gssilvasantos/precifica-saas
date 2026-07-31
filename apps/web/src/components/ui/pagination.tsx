import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from './button';
import { cn } from '../../lib/utils';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

// Paginação genérica (extraída de OrderTable, 29/07/2026 — pedido do
// usuário: com dezenas de páginas, só Anterior/Próxima não é prático).
// Retrofit shadcn/ui (mesma data, fase seguinte) — botões migrados para o
// primitivo Button (variant="outline"/"default" em vez de bg-ink-900/
// border-ink-300 hardcoded), assim o número da página ativa reaproveita o
// par primary/primary-foreground já resolvido para Light/Dark. O campo "ir
// para página" segue os tokens semânticos (border-input/bg-background) por
// ainda não existir um primitivo Input dedicado.
export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  const [goToValue, setGoToValue] = useState('');

  function clamp(value: number): number {
    return Math.max(1, Math.min(totalPages, value));
  }

  function handleGoTo(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(goToValue);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    onPageChange(clamp(Math.trunc(parsed)));
    setGoToValue('');
  }

  const pageNumbers = buildPageWindow(page, totalPages);

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(clamp(page - 1))}>
        Anterior
      </Button>

      <div className="flex gap-1">
        {pageNumbers.map((entry, idx) =>
          entry === 'ellipsis' ? (
            <span key={`ellipsis-${idx}`} className="px-1.5 text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              type="button"
              key={entry}
              size="sm"
              variant={entry === page ? 'default' : 'outline'}
              aria-current={entry === page ? 'page' : undefined}
              className="min-w-[2rem] px-2"
              onClick={() => onPageChange(entry)}
            >
              {entry}
            </Button>
          ),
        )}
      </div>

      <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(clamp(page + 1))}>
        Próxima
      </Button>

      <form onSubmit={handleGoTo} className="flex items-center gap-1.5">
        <label htmlFor="pagination-goto" className="text-muted-foreground">
          Ir para
        </label>
        <input
          id="pagination-goto"
          type="number"
          min={1}
          max={totalPages}
          value={goToValue}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setGoToValue(event.target.value)}
          placeholder={String(page)}
          className="h-8 w-16 rounded-md border border-input bg-background px-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        <Button type="submit" variant="outline" size="sm">
          Ir
        </Button>
      </form>
    </div>
  );
}

// Janela de páginas mostradas: sempre 1 e totalPages, a atual +- 1 vizinho,
// reticências pros buracos — evita renderizar dezenas de botões quando só a
// região perto da página atual importa (ex.: 34 páginas -> "1 … 16 17 18 … 34").
function buildPageWindow(page: number, totalPages: number): (number | 'ellipsis')[] {
  const SIBLINGS = 1;
  const result: (number | 'ellipsis')[] = [];

  const start = Math.max(2, page - SIBLINGS);
  const end = Math.min(totalPages - 1, page + SIBLINGS);

  result.push(1);
  if (start > 2) result.push('ellipsis');
  for (let p = start; p <= end; p++) result.push(p);
  if (end < totalPages - 1) result.push('ellipsis');
  if (totalPages > 1) result.push(totalPages);

  return result;
}
