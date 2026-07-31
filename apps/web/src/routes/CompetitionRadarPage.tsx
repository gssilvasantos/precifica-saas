import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  createMonitoredListing,
  deactivateMonitoredListing,
  fetchCompetitiveOpportunities,
  fetchMonitoredListings,
  runCompetitionMonitorNow,
  type CreateMonitoredListingInput,
} from '../features/competition/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function BuyBoxBadge({ status }: { status: 'WINNING' | 'LOSING' | 'UNKNOWN' }) {
  if (status === 'WINNING') return <Badge variant="success">Ganhando</Badge>;
  if (status === 'LOSING') return <Badge variant="danger">Perdendo</Badge>;
  return <Badge variant="secondary">Desconhecido</Badge>;
}

function OpportunitiesSection() {
  const opportunitiesQuery = useQuery({ queryKey: ['competitive-opportunities'], queryFn: fetchCompetitiveOpportunities });
  const opportunities = opportunitiesQuery.data ?? [];

  return (
    <Card className="p-5">
      <h2 className="font-serif text-lg font-semibold text-foreground">Oportunidades detectadas</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Última leitura de preço/buy box de cada SKU monitorado, atualizada pelo ciclo de monitoramento.
      </p>

      {opportunitiesQuery.isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>}
      {!opportunitiesQuery.isLoading && opportunities.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">Nenhuma oportunidade detectada ainda — cadastre um item monitorado abaixo.</p>
      )}
      {opportunities.length > 0 && (
        <table className="mt-3 w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">SKU</th>
              <th className="py-1.5 pr-3 font-medium">Melhor concorrente</th>
              <th className="py-1.5 pr-3 font-medium">Preço concorrente</th>
              <th className="py-1.5 pr-3 font-medium">Nosso preço</th>
              <th className="py-1.5 pr-3 font-medium">Gap</th>
              <th className="py-1.5 pr-3 font-medium">Buy Box</th>
              <th className="py-1.5 pr-3 font-medium">Detectado em</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((o) => (
              <tr key={o.skuCode} className="border-t border-border/60">
                <td className="py-1.5 pr-3 font-sans text-foreground">{o.skuCode}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{o.bestCompetitorLabel}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{currencyFormatter.format(o.bestCompetitorPrice)}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{o.ourPrice !== null ? currencyFormatter.format(o.ourPrice) : '—'}</td>
                <td className={`py-1.5 pr-3 font-sans font-medium ${o.priceGapPct < 0 ? 'text-margin-danger' : 'text-margin-good'}`}>
                  {o.priceGapPct > 0 ? '+' : ''}
                  {o.priceGapPct.toFixed(1)}%
                </td>
                <td className="py-1.5 pr-3">
                  <BuyBoxBadge status={o.buyBoxStatus} />
                </td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{dateFormatter.format(new Date(o.detectedAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function CreateMonitoredListingForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [skuCode, setSkuCode] = useState('');
  const [competitorLabel, setCompetitorLabel] = useState('');
  const [targetRef, setTargetRef] = useState('');
  const [radarCode, setRadarCode] = useState('MANUAL_SHEET_IMPORT');
  const [channelCode, setChannelCode] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      createMonitoredListing({
        skuCode: skuCode.trim(),
        competitorLabel: competitorLabel.trim(),
        targetRef: targetRef.trim(),
        radarCode: radarCode.trim(),
        channelCode: channelCode.trim() === '' ? undefined : channelCode.trim(),
      } as CreateMonitoredListingInput),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['monitored-listings'] });
      onDone();
    },
  });

  const canSubmit = skuCode.trim() !== '' && competitorLabel.trim() !== '' && targetRef.trim() !== '' && radarCode.trim() !== '';

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">Novo item monitorado</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Hoje só existe o radar <strong>MANUAL_SHEET_IMPORT</strong> (planilha importada manualmente) — outros radars aparecem aqui assim que forem
        cadastrados no backend.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          SKU (nosso produto)
          <input value={skuCode} onChange={(e) => setSkuCode(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Rótulo do concorrente
          <input value={competitorLabel} onChange={(e) => setCompetitorLabel(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Referência do alvo (ID/URL do anúncio do concorrente)
          <input value={targetRef} onChange={(e) => setTargetRef(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Radar
          <input value={radarCode} onChange={(e) => setRadarCode(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Canal (opcional — nosso preço para calcular o gap)
          <input value={channelCode} onChange={(e) => setChannelCode(e.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button disabled={!canSubmit || createMutation.isPending} onClick={() => createMutation.mutate()}>
          {createMutation.isPending ? 'Criando…' : 'Cadastrar'}
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        {createMutation.isError && <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(createMutation.error)}</span>}
      </div>
    </Card>
  );
}

function MonitoredListingsSection({ canEdit, isAdmin }: { canEdit: boolean; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const listingsQuery = useQuery({ queryKey: ['monitored-listings'], queryFn: fetchMonitoredListings });
  const listings = listingsQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['monitored-listings'] });
  const deactivateMutation = useMutation({ mutationFn: (id: string) => deactivateMonitoredListing(id), onSuccess: invalidate });
  const runNowMutation = useMutation({ mutationFn: runCompetitionMonitorNow });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground">Itens monitorados</h2>
          <p className="mt-1 text-xs text-muted-foreground">Configuração de "o que monitorar" — só ADMIN cadastra/desativa.</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" disabled={runNowMutation.isPending} onClick={() => runNowMutation.mutate()}>
              {runNowMutation.isPending ? 'Rodando…' : 'Rodar ciclo agora'}
            </Button>
          )}
          {canEdit && !showForm && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              Novo item
            </Button>
          )}
        </div>
      </div>
      {runNowMutation.isSuccess && <p className="mt-2 text-xs font-medium text-margin-good">Ciclo de monitoramento disparado.</p>}
      {runNowMutation.isError && <p className="mt-2 text-xs font-medium text-margin-danger">{extractErrorMessage(runNowMutation.error)}</p>}

      {showForm && (
        <div className="mt-3">
          <CreateMonitoredListingForm onDone={() => setShowForm(false)} />
        </div>
      )}

      {listingsQuery.isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>}
      {!listingsQuery.isLoading && listings.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nenhum item monitorado ainda.</p>}
      {listings.length > 0 && (
        <table className="mt-3 w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">SKU</th>
              <th className="py-1.5 pr-3 font-medium">Concorrente</th>
              <th className="py-1.5 pr-3 font-medium">Radar</th>
              <th className="py-1.5 pr-3 font-medium">Canal</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              {canEdit && <th className="py-1.5 pr-3 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id} className="border-t border-border/60">
                <td className="py-1.5 pr-3 font-sans text-foreground">{l.skuCode}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{l.competitorLabel}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{l.radarCode}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{l.channelCode ?? '—'}</td>
                <td className="py-1.5 pr-3">
                  <Badge variant={l.isActive ? 'success' : 'secondary'}>{l.isActive ? 'Ativo' : 'Inativo'}</Badge>
                </td>
                {canEdit && (
                  <td className="py-1.5 pr-3">
                    {l.isActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="hover:border-margin-danger hover:text-margin-danger"
                        disabled={deactivateMutation.isPending}
                        onClick={() => deactivateMutation.mutate(l.id)}
                      >
                        Desativar
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {deactivateMutation.isError && <p className="mt-2 text-xs font-medium text-margin-danger">{extractErrorMessage(deactivateMutation.error)}</p>}
    </Card>
  );
}

export default function CompetitionRadarPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const canEdit = isAdmin;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">Radar de Concorrência</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Monitoramento de preço e buy box de concorrentes por SKU, com gap percentual contra o nosso preço vigente no canal.
        </p>
      </div>

      <OpportunitiesSection />
      <MonitoredListingsSection canEdit={canEdit} isAdmin={isAdmin} />
    </div>
  );
}
