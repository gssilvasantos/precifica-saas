import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMode } from '../../features/app-mode/app-mode-context';
import { fetchAuditStatus, seedAuditData, clearAuditData } from '../../features/app-mode/api';

// Modo de Demonstração / Audit Mode (ver docs/audit-mode.md) — botão
// DISCRETO, visível/ativo só para Admin (mesma exigência do briefing e dos
// endpoints /audit-mode no backend). Para qualquer outro papel, o componente
// não renderiza nada — nem um botão desabilitado, para não sugerir que a
// funcionalidade existe para quem não pode usá-la.
export default function AppModeToggle() {
  const { mode, canToggle, setMode } = useAppMode();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['audit-mode-status'],
    queryFn: fetchAuditStatus,
    enabled: canToggle && open,
  });

  const seedMutation = useMutation({
    mutationFn: seedAuditData,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['audit-mode-status'] });
      void queryClient.invalidateQueries();
    },
  });

  const clearMutation = useMutation({
    mutationFn: clearAuditData,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['audit-mode-status'] });
      void queryClient.invalidateQueries();
    },
  });

  if (!canToggle) return null;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Modo de Demonstração (Audit Mode) — só Admin"
        className={[
          'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
          mode === 'DEMO'
            ? 'border-neon/60 bg-neon/10 text-neon'
            : 'border-white/20 text-white/50 hover:text-white/80',
        ].join(' ')}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${mode === 'DEMO' ? 'bg-neon' : 'bg-white/40'}`} />
        {mode === 'DEMO' ? 'Demo' : 'Real'}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-ink-300/60 bg-surface p-3 text-ink-900 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Audit Mode</p>
          <p className="mt-1 text-xs text-ink-500">
            {statusQuery.data ? `${statusQuery.data.totalDemoOrders} pedido(s) de demonstração no tenant.` : '—'}
          </p>

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setMode('REAL')}
              className={[
                'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition',
                mode === 'REAL' ? 'bg-ink-900 text-white' : 'bg-canvas text-ink-700 hover:bg-ink-300/40',
              ].join(' ')}
            >
              Real
            </button>
            <button
              onClick={() => setMode('DEMO')}
              className={[
                'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition',
                mode === 'DEMO' ? 'bg-ink-900 text-white' : 'bg-canvas text-ink-700 hover:bg-ink-300/40',
              ].join(' ')}
            >
              Demo
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-1.5 border-t border-ink-300/60 pt-3">
            <button
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
              className="rounded-lg border border-ink-300 px-2 py-1.5 text-xs font-medium text-ink-700 transition hover:border-neon disabled:opacity-50"
            >
              {seedMutation.isPending ? 'Semeando…' : 'Semear os 10 pedidos de demonstração'}
            </button>
            <button
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
              className="rounded-lg border border-ink-300 px-2 py-1.5 text-xs font-medium text-margin-danger transition hover:border-margin-danger disabled:opacity-50"
            >
              {clearMutation.isPending ? 'Limpando…' : 'Limpar dados de demonstração'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
