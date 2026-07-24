import { useState } from 'react';
import { TAX_REGIME_LABEL, type TaxProfile, type TaxProfileInput, type TaxRegime } from '../api';

const REGIME_OPTIONS = Object.keys(TAX_REGIME_LABEL) as TaxRegime[];

interface Props {
  initial?: TaxProfile;
  onSubmit: (input: TaxProfileInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

// Form inline de criação/edição de perfil fiscal — mesmo perfil pode ser
// vinculado a vários produtos (Product.taxProfileId), então só define regime
// + alíquota estimada, nunca um produto específico.
export default function TaxProfileForm({ initial, onSubmit, onCancel, isSubmitting }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [regime, setRegime] = useState<TaxRegime>(initial?.regime ?? 'SIMPLES_NACIONAL');
  const [estimatedRatePct, setEstimatedRatePct] = useState(initial ? String(initial.estimatedRatePct) : '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const canSubmit = name.trim().length > 0 && Number(estimatedRatePct) >= 0 && Number(estimatedRatePct) <= 100;

  return (
    <div className="rounded-2xl bg-surface p-5 shadow-card">
      <h3 className="font-serif text-base font-semibold text-ink-900">
        {initial ? 'Editar perfil fiscal' : 'Novo perfil fiscal'}
      </h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-ink-700 sm:col-span-2">
          Nome
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Simples Nacional — Anexo I"
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
          />
        </label>

        <label className="text-xs font-medium text-ink-700">
          Regime
          <select
            value={regime}
            onChange={(e) => setRegime(e.target.value as TaxRegime)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
          >
            {REGIME_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {TAX_REGIME_LABEL[r]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-ink-700">
          Alíquota estimada (%)
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={estimatedRatePct}
            onChange={(e) => setEstimatedRatePct(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
          />
        </label>

        <label className="text-xs font-medium text-ink-700 sm:col-span-2">
          Notas (opcional)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={!canSubmit || isSubmitting}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              regime,
              estimatedRatePct: Number(estimatedRatePct),
              notes: notes.trim() === '' ? undefined : notes.trim(),
            })
          }
          className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-margin-danger hover:text-margin-danger"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
