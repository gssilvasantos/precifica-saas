import type { AdsCampaignInsight } from '../api';
import { TIER_META } from '../tier-meta';
import ChannelBadge from '../../../components/orders/ChannelBadge';
import { Card } from '../../../components/ui/card';
import { cn } from '../../../lib/utils';

interface Props {
  campaign: AdsCampaignInsight;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = new Intl.NumberFormat('pt-BR');

// Card de campanha do dashboard de Ads (Bloco 1 do sprint de Layout/UI) —
// ROAS + tier (ESTRELA/PONTO_DE_ATENCAO/CUSTO_PERDIDO/SEM_DADOS) em
// destaque, mesma disciplina visual de OrderTable/KpiCard: números densos
// em font-sans, tier como badge colorido (TIER_META), sem inventar uma
// paleta nova.
export default function AdsCampaignCard({ campaign }: Props) {
  const meta = TIER_META[campaign.tier];

  return (
    <Card className={cn('p-5 transition', meta.cardClass)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <ChannelBadge channelCode={campaign.channelCode} size="sm" />
          <p className="mt-1.5 font-serif text-base font-semibold text-foreground">{campaign.name}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${meta.badgeClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
          {meta.label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">ROAS</p>
          <p className="mt-0.5 font-serif text-xl font-semibold text-foreground">
            {campaign.roas !== null ? `${campaign.roas.toFixed(2)}x` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Investido</p>
          <p className="mt-0.5 text-sm font-medium text-foreground">{currency.format(campaign.totals.spend)}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Receita ads</p>
          <p className="mt-0.5 text-sm font-medium text-foreground">{currency.format(campaign.totals.revenueAds)}</p>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span>{number.format(campaign.totals.clicks)} cliques</span>
        <span>{number.format(campaign.totals.impressions)} impressões</span>
      </div>

      <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-foreground">{campaign.recommendation}</p>
    </Card>
  );
}
