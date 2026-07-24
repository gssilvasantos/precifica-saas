import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchPromotionCampaigns } from '../features/promotions/api';
import { useAuth } from '../features/auth/auth-context';
import ChannelBadge from '../components/orders/ChannelBadge';
import CampaignStatusBadge from '../features/promotions/components/CampaignStatusBadge';
import CreateCampaignPanel from '../features/promotions/components/CreateCampaignPanel';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

// Promotion Intelligence — Bloco 2 do sprint de Layout/UI. Ver
// domain/margin-calculator.ts (Sprint 26) para a régua de negócio: cada
// campanha agrupa SKUs inscritos com o "Semáforo de Margem" já calculado no
// momento da adesão (tela de detalhe).
export default function PromotionsPage() {
  const { user } = useAuth();
  const canCreate = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const campaignsQuery = useQuery({ queryKey: ['promotion-campaigns'], queryFn: fetchPromotionCampaigns });
  const campaigns = campaignsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-ink-900">Promoções</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            Campanhas por canal com Validação Proativa — nenhum SKU entra numa promoção sem que a margem líquida
            tenha sido calculada e aprovada primeiro.
          </p>
        </div>
        {canCreate && <CreateCampaignPanel />}
      </div>

      <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink-300/60 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-5 py-3 font-medium">Campanha</th>
              <th className="px-5 py-3 font-medium">Canal</th>
              <th className="px-5 py-3 font-medium">Período</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {campaignsQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-ink-500">
                  Carregando campanhas…
                </td>
              </tr>
            )}

            {!campaignsQuery.isLoading && campaigns.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-ink-500">
                  Nenhuma campanha criada ainda.
                </td>
              </tr>
            )}

            {campaigns.map((campaign) => (
              <tr key={campaign.id} className="border-b border-ink-300/30 last:border-0 hover:bg-canvas/60">
                <td className="px-5 py-3 font-medium text-ink-900">{campaign.name}</td>
                <td className="px-5 py-3">
                  <ChannelBadge channelCode={campaign.channelCode} size="sm" />
                </td>
                <td className="px-5 py-3 font-sans text-ink-700">
                  {dateFormat.format(new Date(campaign.startAt))} – {dateFormat.format(new Date(campaign.endAt))}
                </td>
                <td className="px-5 py-3">
                  <CampaignStatusBadge status={campaign.status} />
                </td>
                <td className="px-5 py-3 text-right">
                  <Link
                    to={`/promocoes/${campaign.id}`}
                    className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-gold hover:text-gold"
                  >
                    Ver detalhes
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
