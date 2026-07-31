import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { enrollSkuInCampaign, previewCampaignMargin, type MarginPreview } from '../api';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

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
    <Card className="p-5">
      <h2 className="font-serif text-base font-semibold text-foreground">Semáforo de Margem</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Simule a margem líquida de um SKU nesta campanha antes de confirmar a inscrição.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-foreground">
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
            className="mt-1 block w-40 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="text-xs font-medium text-foreground">
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
            className="mt-1 block w-32 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={!canSimulate || previewMutation.isPending}>
          {previewMutation.isPending ? 'Calculando…' : 'Simular'}
        </Button>
      </div>

      {previewMutation.isError && (
        <p className="mt-3 text-xs font-medium text-margin-danger">Não foi possível simular — verifique o SKU e tente novamente.</p>
      )}

      {preview && (
        <div className="mt-4 rounded-xl border border-border p-4">
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                isVerde ? 'bg-margin-good/15 text-margin-good' : 'bg-margin-danger/15 text-margin-danger'
              }`}
            >
              {isVerde ? 'VERDE — margem positiva' : 'VERMELHO — margem negativa ou zero'}
            </span>
            <span className="font-sans text-lg font-semibold text-foreground">
              {currency.format(preview.netMarginAmount)} ({percent.format(preview.netMarginPct)}%)
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-foreground sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Custo</dt>
              <dd className="font-sans font-medium">{currency.format(preview.costPriceUsed)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Taxas do canal</dt>
              <dd className="font-sans font-medium">{currency.format(preview.feesAmount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Impostos</dt>
              <dd className="font-sans font-medium">{currency.format(preview.taxAmount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Logística</dt>
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
              <Button onClick={() => enrollMutation.mutate()} disabled={enrollMutation.isPending}>
                {enrollMutation.isPending ? 'Inscrevendo…' : 'Inscrever SKU na campanha'}
              </Button>
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
    </Card>
  );
}
