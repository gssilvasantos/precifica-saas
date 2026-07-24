import { useQuery } from '@tanstack/react-query';
import { fetchAdsDashboard, fetchPendingAdsActions } from '../features/ads/api';
import { useAppMode } from '../features/app-mode/app-mode-context';
import KpiCard from '../components/dashboard/KpiCard';
import CircuitBackground from '../components/dashboard/CircuitBackground';
import AppModeToggle from '../components/dashboard/AppModeToggle';
import AdsCampaignCard from '../features/ads/components/AdsCampaignCard';
import AdsSuggestionCard from '../features/ads/components/AdsSuggestionCard';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = (value: number | null) => (value !== null ? `${(value * 100).toFixed(1)}%` : '—');

// Dashboard de Ads Multicanal (Bloco 1 do sprint de Layout/UI, ver
// README.md — Fase 0/Ads standby). Escopo hoje: Mercado Livre (Fases 1-4 do
// backend, docs/marketplace-ads-architecture.md) — a página não pretende
// esconder isso; ChannelBadge de cada campanha já mostra o canal real.
//
// Modo de Demonstração: qualidade dos dados fictícios (AdsAuditSeederService)
// é a peça-chave para a demonstração visual exigida nas auditorias de
// segurança da Amazon/Shopee antes da retomada da Fase 0 — ver
// docs/marketplace-ads-api-access-plan.md e README.md.
export default function AdsPage() {
  const { mode, canToggle } = useAppMode();

  const dashboardQuery = useQuery({
    queryKey: ['marketplace-ads', 'dashboard', mode],
    queryFn: () => fetchAdsDashboard(mode),
  });

  const pendingQuery = useQuery({
    queryKey: ['marketplace-ads', 'pending', mode],
    queryFn: () => fetchPendingAdsActions(mode),
  });

  const dashboard = dashboardQuery.data;
  const pending = pendingQuery.data ?? [];
  const isLoading = dashboardQuery.isLoading;
  const roasTotal = dashboard && dashboard.totals.spend > 0 ? dashboard.totals.revenueAds / dashboard.totals.spend : null;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-ink-900 px-6 py-8 text-white">
        <CircuitBackground />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-neon">Kyneti · Ads Multicanal</p>
            <h1 className="mt-1 font-serif text-2xl font-semibold text-white md:text-3xl">Dashboard de Ads</h1>
            <p className="mt-1 max-w-xl text-sm text-white/60">
              ROAS por campanha, TACOS agregado e sugestões de ação (regra automática ou IA) — confirmação sempre
              humana, nunca automática.
            </p>
          </div>
          <AppModeToggle />
        </div>
      </div>

      {mode === 'DEMO' && (
        <div className="rounded-lg border border-neon/40 bg-neon/10 px-4 py-2 text-xs font-medium text-ink-700">
          Modo Demonstração ativo — campanhas e sugestões abaixo vêm de dados fictícios (AdsAuditSeederService), nunca
          das campanhas reais do tenant.
        </div>
      )}

      {isLoading && (
        <div className="rounded-2xl bg-surface p-8 text-center text-sm text-ink-500 shadow-card">
          Carregando dashboard de Ads…
        </div>
      )}

      {!isLoading && dashboard && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Investido em ads" value={currency.format(dashboard.totals.spend)} caption="Período selecionado" />
            <KpiCard
              label="Receita atribuída a ads"
              value={currency.format(dashboard.totals.revenueAds)}
              caption="Atribuição do próprio marketplace"
              highlight
            />
            <KpiCard label="ROAS agregado" value={roasTotal !== null ? `${roasTotal.toFixed(2)}x` : '—'} caption="Receita ads / investido" />
            <KpiCard
              label="TACOS"
              value={percent(dashboard.tacos)}
              caption="Investido / receita TOTAL do tenant (ads + orgânica)"
            />
          </div>

          {pending.length > 0 && (
            <div>
              <h2 className="mb-3 font-serif text-lg font-semibold text-ink-900">
                Sugestões pendentes de confirmação ({pending.length})
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {pending.map((suggestion) => (
                  <AdsSuggestionCard key={suggestion.id} suggestion={suggestion} canAct={canToggle} />
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="mb-3 font-serif text-lg font-semibold text-ink-900">Campanhas</h2>
            {dashboard.campaigns.length === 0 ? (
              <div className="rounded-2xl bg-surface p-8 text-center text-sm text-ink-500 shadow-card">
                {mode === 'DEMO'
                  ? 'Nenhuma campanha de demonstração semeada ainda — use o botão de Modo Demonstração para semear os dados fictícios.'
                  : 'Nenhuma campanha sincronizada ainda para este período.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {dashboard.campaigns.map((campaign) => (
                  <AdsCampaignCard key={campaign.campaignId} campaign={campaign} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
