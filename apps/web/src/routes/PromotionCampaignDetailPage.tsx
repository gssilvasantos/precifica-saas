import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchPromotionCampaign } from '../features/promotions/api';
import { useAuth } from '../features/auth/auth-context';
import ChannelBadge from '../components/orders/ChannelBadge';
import CampaignStatusBadge from '../features/promotions/components/CampaignStatusBadge';
import MarginPreviewSimulator from '../features/promotions/components/MarginPreviewSimulator';
import EnrollmentTable from '../features/promotions/components/EnrollmentTable';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' });

export default function PromotionCampaignDetailPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { user } = useAuth();
  const canEnroll = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const campaignQuery = useQuery({
    queryKey: ['promotion-campaigns', campaignId],
    queryFn: () => fetchPromotionCampaign(campaignId as string),
    enabled: !!campaignId,
  });

  if (campaignQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando campanha…</p>;
  }

  if (!campaignQuery.data) {
    return <p className="text-sm text-muted-foreground">Campanha não encontrada.</p>;
  }

  const campaign = campaignQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/promocoes" className="text-xs font-medium text-muted-foreground hover:text-foreground">
          ← Voltar para Promoções
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl font-semibold text-foreground">{campaign.name}</h1>
          <CampaignStatusBadge status={campaign.status} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <ChannelBadge channelCode={campaign.channelCode} size="sm" />
          <span>
            {dateFormat.format(new Date(campaign.startAt))} – {dateFormat.format(new Date(campaign.endAt))}
          </span>
        </div>
      </div>

      {campaignId && <MarginPreviewSimulator campaignId={campaignId} canEnroll={canEnroll} />}

      {campaignId && <EnrollmentTable campaignId={campaignId} />}
    </div>
  );
}
