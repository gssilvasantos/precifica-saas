import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ORDER_CHANNELS } from '../../orders/channels';
import { createPromotionCampaign } from '../api';

// Criação de campanha promocional — POST /promotion-intelligence/campaigns
// (ADMIN + PRICING_EDITOR no backend). Reaproveita a lista de canais de
// features/orders/channels.ts em vez de duplicar metadados de marketplace.
export default function CreateCampaignPanel() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [channelCode, setChannelCode] = useState(ORDER_CHANNELS[0]?.code ?? '');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      createPromotionCampaign({
        name: name.trim(),
        channelCode,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
      }),
    onSuccess: (campaign) => {
      void queryClient.invalidateQueries({ queryKey: ['promotion-campaigns'] });
      navigate(`/promocoes/${campaign.id}`);
    },
  });

  const canSubmit = name.trim().length > 0 && channelCode !== '' && startAt !== '' && endAt !== '';

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-700"
      >
        Nova campanha
      </button>
    );
  }

  return (
    <div className="rounded-2xl bg-surface p-5 shadow-card">
      <h2 className="font-serif text-base font-semibold text-ink-900">Nova campanha promocional</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-ink-700">
          Nome da campanha
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Black Friday 2026"
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
          />
        </label>

        <label className="text-xs font-medium text-ink-700">
          Canal
          <select
            value={channelCode}
            onChange={(e) => setChannelCode(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
          >
            {ORDER_CHANNELS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-ink-700">
          Início
          <input
            type="date"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
          />
        </label>

        <label className="text-xs font-medium text-ink-700">
          Fim
          <input
            type="date"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
          />
        </label>
      </div>

      {createMutation.isError && (
        <p className="mt-3 text-xs font-medium text-margin-danger">Não foi possível criar a campanha — tente novamente.</p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit || createMutation.isPending}
          className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-700 disabled:opacity-50"
        >
          {createMutation.isPending ? 'Criando…' : 'Criar campanha'}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-margin-danger hover:text-margin-danger"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
