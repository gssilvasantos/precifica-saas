import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdsActionSuggestion } from '../api';
import { confirmAdsAction, rejectAdsAction } from '../api';
import ChannelBadge from '../../../components/orders/ChannelBadge';

interface Props {
  suggestion: AdsActionSuggestion;
  canAct: boolean; // Safety Lock é ADMIN-only no backend — o botão só aparece pra quem pode de fato usá-lo
}

const ACTION_LABEL: Record<AdsActionSuggestion['actionType'], string> = {
  PAUSE_CAMPAIGN: 'Pausar campanha',
};

// Card de sugestão de ação (Fase 2/3/4 — Safety Lock) — pedido explícito do
// briefing: o `reasoning` da IA e o `confidenceScore` precisam estar em
// destaque para que a confirmação humana seja uma decisão consciente e
// rápida, não um clique automático. Por isso:
// - reasoning (campo `reason`) é o bloco de texto PRINCIPAL do card, em
//   destaque tipográfico — não uma legenda pequena.
// - confidenceScore aparece como um número grande + barra, só quando a
//   origem é AI (RULE_BASED não tem confiança nenhuma pra mostrar — é uma
//   regra determinística, não uma estimativa).
// - o acento neon (reservado no design system pra "alta intelligence") é
//   usado aqui de propósito: é exatamente o caso de uso que o token
//   describe (insight de IA, estado que pede atenção consciente).
export default function AdsSuggestionCard({ suggestion, canAct }: Props) {
  const queryClient = useQueryClient();
  const [showMetadata, setShowMetadata] = useState(false);
  const isAi = suggestion.source === 'AI';

  const confirmMutation = useMutation({
    mutationFn: () => confirmAdsAction(suggestion.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['marketplace-ads'] }),
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectAdsAction(suggestion.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['marketplace-ads'] }),
  });
  const isPending = confirmMutation.isPending || rejectMutation.isPending;

  const metadataEntries = suggestion.metadata ? Object.entries(suggestion.metadata) : [];

  return (
    <div
      className={[
        'rounded-2xl bg-surface p-5 shadow-card',
        isAi ? 'ring-1 ring-neon/50 shadow-neonGlow' : 'ring-1 ring-margin-danger/30',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ChannelBadge channelCode={suggestion.channelCode} size="sm" />
          <span className="text-sm font-medium text-ink-900">{suggestion.campaignName}</span>
        </div>
        <span
          className={[
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
            isAi ? 'bg-neon/15 text-ink-900' : 'bg-ink-300/40 text-ink-700',
          ].join(' ')}
        >
          {isAi ? '✦ Sugestão da IA' : 'Regra automática'}
        </span>
      </div>

      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-margin-danger">
        Recomendação: {ACTION_LABEL[suggestion.actionType]}
      </p>

      {/* Reasoning — bloco principal do card, tipografia maior/mais legível
          que o resto (o texto que a "confirmação humana consciente" precisa
          ler primeiro). */}
      <p className="mt-3 rounded-xl bg-canvas px-4 py-3 font-serif text-base leading-relaxed text-ink-900">
        {suggestion.reason}
      </p>

      {/* Confidence score — só existe para origem AI; RULE_BASED não fabrica um número. */}
      {isAi && suggestion.confidenceScore !== null && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-neon/30 bg-neon/5 px-4 py-3">
          <div className="shrink-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Confiança da IA</p>
            <p className="font-serif text-2xl font-semibold text-ink-900">
              {Math.round(suggestion.confidenceScore * 100)}%
            </p>
          </div>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-300/40">
            <div
              className="h-full rounded-full bg-neon"
              style={{ width: `${Math.round(suggestion.confidenceScore * 100)}%` }}
            />
          </div>
        </div>
      )}

      {metadataEntries.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowMetadata((v) => !v)}
            className="text-xs font-medium text-ink-500 underline decoration-dotted underline-offset-2 hover:text-ink-700"
          >
            {showMetadata ? 'Ocultar detalhes' : 'Ver detalhes do cálculo'}
          </button>
          {showMetadata && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-canvas px-3 py-2 text-xs sm:grid-cols-3">
              {metadataEntries.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-ink-500">{key}</dt>
                  <dd className="font-medium text-ink-700">{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] text-ink-500">
        Nenhuma ação é aplicada automaticamente — confirmar ou rejeitar é sempre uma decisão humana (Safety Lock).
      </p>

      {canAct && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => confirmMutation.mutate()}
            disabled={isPending}
            className="flex-1 rounded-lg bg-ink-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-ink-700 disabled:opacity-50"
          >
            {confirmMutation.isPending ? 'Confirmando…' : 'Confirmar e pausar'}
          </button>
          <button
            type="button"
            onClick={() => rejectMutation.mutate()}
            disabled={isPending}
            className="flex-1 rounded-lg border border-ink-300 px-3 py-2 text-xs font-medium text-ink-700 transition hover:border-margin-danger hover:text-margin-danger disabled:opacity-50"
          >
            {rejectMutation.isPending ? 'Rejeitando…' : 'Rejeitar'}
          </button>
        </div>
      )}

      {confirmMutation.isError && (
        <p className="mt-2 text-xs text-margin-danger">Não foi possível confirmar — tente novamente.</p>
      )}
      {rejectMutation.isError && (
        <p className="mt-2 text-xs text-margin-danger">Não foi possível rejeitar — tente novamente.</p>
      )}
    </div>
  );
}
