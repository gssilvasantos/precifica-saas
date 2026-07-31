import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ORDER_CHANNELS } from '../../orders/channels';
import { createPromotionCampaign } from '../api';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

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
      <Button onClick={() => setIsOpen(true)}>
        Nova campanha
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="font-serif text-base font-semibold text-foreground">Nova campanha promocional</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          Nome da campanha
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Black Friday 2026"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <label className="text-xs font-medium text-foreground">
          Canal
          <select
            value={channelCode}
            onChange={(e) => setChannelCode(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ORDER_CHANNELS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-foreground">
          Início
          <input
            type="date"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <label className="text-xs font-medium text-foreground">
          Fim
          <input
            type="date"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>

      {createMutation.isError && (
        <p className="mt-3 text-xs font-medium text-margin-danger">Não foi possível criar a campanha — tente novamente.</p>
      )}

      <div className="mt-4 flex gap-2">
        <Button onClick={() => createMutation.mutate()} disabled={!canSubmit || createMutation.isPending}>
          {createMutation.isPending ? 'Criando…' : 'Criar campanha'}
        </Button>
        <Button
          variant="outline"
          className="hover:border-margin-danger hover:text-margin-danger"
          onClick={() => setIsOpen(false)}
        >
          Cancelar
        </Button>
      </div>
    </Card>
  );
}
