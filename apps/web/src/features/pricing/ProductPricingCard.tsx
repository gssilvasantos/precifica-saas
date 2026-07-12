import type { ReactNode } from 'react';
import MarginBar from './MarginBar';
import type { ChannelMeta } from './channels';

export interface ChannelPricingData {
  grossPrice: number;
  costPrice: number;
  marginPct: number;
  feeLabel: string;
  feeRuleFound: boolean;
}

interface Props {
  channel: ChannelMeta;
  isBestMargin: boolean;
  data: ChannelPricingData | null;
  isLoading?: boolean;
  scenarioControls?: ReactNode;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ProductPricingCard({ channel, isBestMargin, data, isLoading, scenarioControls }: Props) {
  return (
    <div
      className={[
        'relative flex flex-col gap-4 rounded-2xl bg-surface p-5 shadow-card transition',
        isBestMargin ? 'animate-goldPulse' : '',
      ].join(' ')}
    >
      {isBestMargin && (
        <div className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-gold px-3 py-1 text-xs font-semibold text-white shadow-sm">
          <StarIcon /> Melhor margem
        </div>
      )}

      <header className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold"
          style={{ backgroundColor: channel.brandColor, color: channel.brandInk }}
        >
          {channel.initial}
        </span>
        <div>
          <p className="font-sans text-sm font-semibold text-ink-900">{channel.label}</p>
          {!channel.connected && <p className="text-xs text-ink-500">Aguardando integração</p>}
        </div>
      </header>

      {!channel.connected && (
        <p className="rounded-lg bg-canvas px-3 py-4 text-center text-xs text-ink-500">
          Este canal ainda não sincroniza vínculo de SKU/preço — nenhum dado inventado aqui.
        </p>
      )}

      {channel.connected && isLoading && (
        <p className="rounded-lg bg-canvas px-3 py-4 text-center text-xs text-ink-500">Calculando cenário…</p>
      )}

      {channel.connected && !isLoading && !data && (
        <p className="rounded-lg bg-canvas px-3 py-4 text-center text-xs text-ink-500">
          Sem vínculo de SKU para este produto ainda. Rode a sincronização em Integrações.
        </p>
      )}

      {channel.connected && !isLoading && data && (
        <>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-500">Preço de venda</p>
              <p className="font-sans text-2xl font-bold text-ink-900">{currency.format(data.grossPrice)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-ink-500">Custo</p>
              <p className="font-sans text-sm text-ink-700">{currency.format(data.costPrice)}</p>
            </div>
          </div>

          <MarginBar pct={data.marginPct} />

          <p className="text-xs text-ink-500">{data.feeLabel}</p>
          {!data.feeRuleFound && (
            <p className="text-xs text-margin-warning">
              Taxa de gateway não cadastrada ainda — cálculo assumiu 0%. Cadastre em Marketplace Intelligence.
            </p>
          )}

          {scenarioControls}
        </>
      )}
    </div>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
      <path d="M10 1.5l2.47 5.6 6.03.53-4.58 4 1.37 5.9L10 14.8l-5.29 2.73 1.37-5.9-4.58-4 6.03-.53L10 1.5z" />
    </svg>
  );
}
