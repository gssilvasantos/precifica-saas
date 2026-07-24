import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchFinancialPolicy, updateFinancialPolicy } from '../api';

interface Props {
  canEdit: boolean;
}

// Política financeira global (Etapa 13 + Fase 4 de Ads) — taxRatePct e
// minProfitMarginPct alimentam o piso financeiro do PricingStrategist
// (defesa em profundidade, junto com o MAP); targetRoas alimenta o motor de
// otimização de Ads. Mudar aqui invalida o cache do FinancialPolicyReader
// no backend e reflete imediatamente no motor de precificação.
export default function FinancialPolicyForm({ canEdit }: Props) {
  const queryClient = useQueryClient();
  const policyQuery = useQuery({ queryKey: ['catalog-settings', 'financial-policy'], queryFn: fetchFinancialPolicy });

  const [taxRatePct, setTaxRatePct] = useState('');
  const [minProfitMarginPct, setMinProfitMarginPct] = useState('');
  const [targetRoas, setTargetRoas] = useState('');

  useEffect(() => {
    if (policyQuery.data) {
      setTaxRatePct(String(policyQuery.data.taxRatePct));
      setMinProfitMarginPct(String(policyQuery.data.minProfitMarginPct));
      setTargetRoas(policyQuery.data.targetRoas !== null ? String(policyQuery.data.targetRoas) : '');
    }
  }, [policyQuery.data]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateFinancialPolicy({
        taxRatePct: Number(taxRatePct),
        minProfitMarginPct: Number(minProfitMarginPct),
        ...(targetRoas.trim() !== '' ? { targetRoas: Number(targetRoas) } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['catalog-settings', 'financial-policy'] });
    },
  });

  const canSubmit =
    Number(taxRatePct) >= 0 &&
    Number(taxRatePct) <= 100 &&
    Number(minProfitMarginPct) >= 0 &&
    Number(minProfitMarginPct) <= 100 &&
    (targetRoas.trim() === '' || Number(targetRoas) > 0);

  return (
    <div className="rounded-2xl bg-surface p-5 shadow-card">
      <h2 className="font-serif text-xl font-semibold text-ink-900">Política financeira global</h2>
      <p className="mt-1 text-sm text-ink-500">
        Piso financeiro aplicado a toda decisão de preço (defesa em profundidade, junto com o MAP) e meta de ROAS
        usada pelo motor de otimização de Ads.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3 sm:max-w-2xl">
        <label className="text-xs font-medium text-ink-700">
          Alíquota (%)
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            disabled={!canEdit}
            value={taxRatePct}
            onChange={(e) => setTaxRatePct(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none disabled:bg-canvas disabled:text-ink-500"
          />
        </label>
        <label className="text-xs font-medium text-ink-700">
          Margem líquida mínima (%)
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            disabled={!canEdit}
            value={minProfitMarginPct}
            onChange={(e) => setMinProfitMarginPct(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none disabled:bg-canvas disabled:text-ink-500"
          />
        </label>
        <label className="text-xs font-medium text-ink-700">
          Meta de ROAS
          <input
            type="number"
            min={0}
            step="0.01"
            disabled={!canEdit}
            value={targetRoas}
            onChange={(e) => setTargetRoas(e.target.value)}
            placeholder="Opcional"
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
            {updateMutation.isPending ? 'Salvando…' : 'Salvar política'}
          </button>
          {updateMutation.isSuccess && (
            <span className="ml-3 text-xs font-medium text-margin-good">Salvo.</span>
          )}
        </div>
      )}
    </div>
  );
}
