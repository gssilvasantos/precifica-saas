import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchDefaultMargins, updateDefaultMargins } from '../api';

interface Props {
  canEdit: boolean;
}

// Margens padrão aplicadas a produtos importados sem margem própria
// definida (desiredMarginPct/minimumMarginPct em CatalogSettings) — piso
// por SKU, conceito separado da política financeira global abaixo.
export default function DefaultMarginsForm({ canEdit }: Props) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['catalog-settings', 'default-margins'], queryFn: fetchDefaultMargins });

  const [desiredMarginPct, setDesiredMarginPct] = useState('');
  const [minimumMarginPct, setMinimumMarginPct] = useState('');

  useEffect(() => {
    if (settingsQuery.data) {
      setDesiredMarginPct(String(settingsQuery.data.desiredMarginPct));
      setMinimumMarginPct(String(settingsQuery.data.minimumMarginPct));
    }
  }, [settingsQuery.data]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateDefaultMargins({
        desiredMarginPct: Number(desiredMarginPct),
        minimumMarginPct: Number(minimumMarginPct),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['catalog-settings', 'default-margins'] });
    },
  });

  const canSubmit =
    Number(desiredMarginPct) >= 0 &&
    Number(desiredMarginPct) <= 100 &&
    Number(minimumMarginPct) >= 0 &&
    Number(minimumMarginPct) <= 100;

  return (
    <div className="rounded-2xl bg-surface p-5 shadow-card">
      <h2 className="font-serif text-xl font-semibold text-ink-900">Margens padrão por SKU</h2>
      <p className="mt-1 text-sm text-ink-500">
        Aplicadas a produtos importados do ERP que ainda não têm margem própria definida.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:max-w-md">
        <label className="text-xs font-medium text-ink-700">
          Margem desejada (%)
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            disabled={!canEdit}
            value={desiredMarginPct}
            onChange={(e) => setDesiredMarginPct(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none disabled:bg-canvas disabled:text-ink-500"
          />
        </label>
        <label className="text-xs font-medium text-ink-700">
          Margem mínima (%)
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            disabled={!canEdit}
            value={minimumMarginPct}
            onChange={(e) => setMinimumMarginPct(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none disabled:bg-canvas disabled:text-ink-500"
          />
        </label>
      </div>

      {canEdit && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => updateMutation.mutate()}
            disabled={!canSubmit || updateMutation.isPending}
            className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-700 disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Salvando…' : 'Salvar margens'}
          </button>
          {updateMutation.isSuccess && (
            <span className="ml-3 text-xs font-medium text-margin-good">Salvo.</span>
          )}
        </div>
      )}
    </div>
  );
}
