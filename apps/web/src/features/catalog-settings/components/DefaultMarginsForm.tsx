import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchDefaultMargins, updateDefaultMargins } from '../api';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

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
    <Card className="p-5">
      <h2 className="font-serif text-xl font-semibold text-foreground">Margens padrão por SKU</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Aplicadas a produtos importados do ERP que ainda não têm margem própria definida.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:max-w-md">
        <label className="text-xs font-medium text-foreground">
          Margem desejada (%)
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            disabled={!canEdit}
            value={desiredMarginPct}
            onChange={(e) => setDesiredMarginPct(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground"
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          Margem mínima (%)
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            disabled={!canEdit}
            value={minimumMarginPct}
            onChange={(e) => setMinimumMarginPct(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground"
          />
        </label>
      </div>

      {canEdit && (
        <div className="mt-4">
          <Button onClick={() => updateMutation.mutate()} disabled={!canSubmit || updateMutation.isPending}>
            {updateMutation.isPending ? 'Salvando…' : 'Salvar margens'}
          </Button>
          {updateMutation.isSuccess && (
            <span className="ml-3 text-xs font-medium text-margin-good">Salvo.</span>
          )}
        </div>
      )}
    </Card>
  );
}
