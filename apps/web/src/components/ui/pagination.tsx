import { useState, type ChangeEvent, type FormEvent } from 'react';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

// Paginação genérica (extraída de OrderTable, 29/07/2026 — pedido do
// usuário: com dezenas de páginas, só Anterior/Próxima não é prático).
// Anterior/Próxima + botões numerados com reticências (janela ao redor da
// página atual, sempre mostrando primeira/última) + campo "ir para página"
// pra pular direto sem clicar N vezes. Pensada pra qualquer tela paginada
// por OFFSET real no banco (nunca cursor) — mesmo padrão de
// GET /orders?page=X (prisma skip/take).
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
    <div className={['flex flex-wrap items-center gap-3', className ?? ''].join(' ')}>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(clamp(page - 1))}
        className="rounded-lg border border-ink-300 px-3 py-1 font-medium text-ink-700 transition hover:border-neon disabled:cursor-not-allowed disabled:opacity-40"
      >
        Anterior
      </button>

      <div className="flex gap-1">
        {pageNumbers.map((entry, idx) =>
          entry === 'ellipsis' ? (
            <span key={`ellipsis-${idx}`} className="px-1.5 text-ink-500">
              …
            </span>
          ) : (
            <button
              type="button"
              key={entry}
              onClick={() => onPageChange(entry)}
              aria-current={entry === page ? 'page' : undefined}
              className={[
                'min-w-[2rem] rounded-lg border px-2 py-1 font-medium transition',
                entry === page
                  ? 'border-ink-900 bg-ink-900 text-white'
                  : 'border-ink-300 text-ink-700 hover:border-neon',
              ].join(' ')}
            >
              {entry}
            </button>
          ),
        )}
      </div>

      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(clamp(page + 1))}
        className="rounded-lg border border-ink-300 px-3 py-1 font-medium text-ink-700 transition hover:border-neon disabled:cursor-not-allowed disabled:opacity-40"
      >
        Próxima
      </button>

      <form onSubmit={handleGoTo} className="flex items-center gap-1.5">
        <label htmlFor="pagination-goto" className="text-ink-500">
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
          className="w-16 rounded-lg border border-ink-300 bg-surface px-2 py-1 text-ink-900 focus:border-neon focus:outline-none focus:ring-1 focus:ring-neon"
        />
        <button
          type="submit"
          className="rounded-lg border border-ink-300 px-2.5 py-1 font-medium text-ink-700 transition hover:border-neon"
        >
          Ir
        </button>
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
