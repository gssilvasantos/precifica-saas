import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { enrollSkuInCampaign, previewCampaignMargin, type MarginPreview } from '../api';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

interface Props {
  campaignId: string;
  canEnroll: boolean;
}

// Simulador "Semáforo de Margem" — GET .../margin-preview é só leitura
// (PromotionIntelligenceService.computeMargin, nenhum dado é persistido).
// A Validação Proativa de verdade só acontece ao inscrever
// (POST .../enrollments): o backend recalcula do zero e SEMPRE grava um
// snapshot (APPROVED ou BLOCKED), nunca deixa PENDING — e sempre responde
// 201, mesmo quando bloqueado, porque o bloqueio é dado de negócio, não erro
// de requisição.
export default function MarginPreviewSimulator({ campaignId, canEnroll }: Props) {
  const queryClient = useQueryClient();
  const [skuCode, setSkuCode] = useState('');
  const [promotionalPrice, setPromotionalPrice] = useState('');
  const [preview, setPreview] = useState<MarginPreview | null>(null);

  const previewMutation = useMutation({
    mutationFn: () => previewCampaignMargin(campaignId, skuCode.trim(), Number(promotionalPrice)),
    onSuccess: (result) => setPreview(result),
  });

  const enrollMutation = useMutation({
    mutationFn: () => enrollSkuInCampaign(campaignId, skuCode.trim(), Number(promotionalPrice)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotion-campaigns', campaignId, 'enrollments'] });
    },
  });

  const canSimulate = skuCode.trim().length > 0 && Number(promotionalPrice) > 0;
  const isVerde = preview?.marginStatus === 'VERDE';

  return (
    <div className="rounded-2xl bg-surface p-5 shadow-card">
      <h2 className="font-serif text-base font-semibold text-ink-900">Semáforo de Margem</h2>
      <p className="mt-1 text-xs text-ink-500">
        Simule a margem líquida de um SKU nesta campanha antes de confirmar a inscrição.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-ink-700">
          SKU
          <input
            type="text"
            value={skuCode}
            onChange={(e) => {
              setSkuCode(e.target.value);
              setPreview(null);
              enrollMutation.reset();
            }}
            placeholder="Ex.: CAM-001"
            className="mt-1 block w-40 rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
          />
        </label>
        <label className="text-xs font-medium text-ink-700">
          Preço promocional
          <input
            type="number"
            min={0}
            step="0.01"
            value={promotionalPrice}
            onChange={(e) => {
              setPromotionalPrice(e.target.value);
              setPreview(null);
              enrollMutation.reset();
            }}
            className="mt-1 block w-32 rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => previewMutation.mutate()}
          disabled={!canSimulate || previewMutation.isPending}
          className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-gold hover:text-gold disabled:opacity-50"
        >
          {previewMutation.isPending ? 'Calculando…' : 'Simular'}
        </button>
      </div>

      {previewMutation.isError && (
        <p className="mt-3 text-xs font-medium text-margin-danger">Não foi possível simular — verifique o SKU e tente novamente.</p>
      )}

      {preview && (
        <div className="mt-4 rounded-xl border border-ink-300/60 p-4">
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                isVerde ? 'bg-margin-good/15 text-margin-good' : 'bg-margin-danger/15 text-margin-danger'
              }`}
            >
              {isVerde ? 'VERDE — margem positiva' : 'VERMELHO — margem negativa ou zero'}
            </span>
            <span className="font-sans text-lg font-semibold text-ink-900">
              {currency.format(preview.netMarginAmount)} ({percent.format(preview.netMarginPct)}%)
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-700 sm:grid-cols-4">
            <div>
              <dt className="text-ink-500">Custo</dt>
              <dd className="font-sans font-medium">{currency.format(preview.costPriceUsed)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Taxas do canal</dt>
              <dd className="font-sans font-medium">{currency.format(preview.feesAmount)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Impostos</dt>
              <dd className="font-sans font-medium">{currency.format(preview.taxAmount)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Logística</dt>
              <dd className="font-sans font-medium">{currency.format(preview.logisticsCost)}</dd>
            </div>
          </dl>

          {!preview.feeRuleFound && (
            <p className="mt-3 rounded-lg bg-margin-warning/10 px-3 py-2 text-xs text-margin-warning">
              Nenhuma regra de taxa cadastrada para este canal — a taxa foi assumida como zero, então a margem real
              pode ser menor que a mostrada.
            </p>
          )}

          {canEnroll && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => enrollMutation.mutate()}
                disabled={enrollMutation.isPending}
                className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-700 disabled:opacity-50"
              >
                {enrollMutation.isPending ? 'Inscrevendo…' : 'Inscrever SKU na campanha'}
              </button>
            </div>
          )}

          {enrollMutation.data && enrollMutation.data.enrollmentStatus === 'APPROVED' && (
            <p className="mt-3 rounded-lg bg-margin-good/10 px-3 py-2 text-xs font-medium text-margin-good">
              Inscrição aprovada — margem líquida positiva confirmada no momento do cálculo.
            </p>
          )}

          {enrollMutation.data && enrollMutation.data.enrollmentStatus === 'BLOCKED' && (
            <p className="mt-3 rounded-lg bg-margin-danger/10 px-3 py-2 text-xs font-medium text-margin-danger">
              Inscrição bloqueada — {enrollMutation.data.blockedReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
