import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  approveRule,
  createManualRule,
  fetchChangeEvents,
  fetchMarketplaceProviders,
  fetchPendingRules,
  pinRule,
  rejectRule,
  triggerProviderSync,
  unpinRule,
  type RuleType,
} from '../features/marketplace-governance/api';
import { fetchSellerProfiles, updateSellerProfile } from '../features/marketplace-governance/seller-profiles-api';
import { fetchWarehouses, updateWarehouseEstimatedFreight } from '../features/logistics-fulfillment/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const RULE_TYPE_OPTIONS: RuleType[] = ['FEE_RULE', 'SHIPPING_POLICY', 'CATEGORY_TAXONOMY'];

function ProvidersSection({ isAdmin }: { isAdmin: boolean }) {
  const providersQuery = useQuery({ queryKey: ['marketplace-providers'], queryFn: fetchMarketplaceProviders });
  const providers = providersQuery.data ?? [];
  const syncMutation = useMutation({ mutationFn: (code: string) => triggerProviderSync(code) });

  return (
    <Card className="p-5">
      <h2 className="font-serif text-lg font-semibold text-foreground">Providers de regras</h2>
      <p className="mt-1 text-xs text-muted-foreground">Fontes registradas de taxas/políticas por marketplace.</p>
      {providersQuery.isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>}
      {!providersQuery.isLoading && providers.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nenhum provider registrado.</p>}
      {providers.length > 0 && (
        <table className="mt-3 w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Canal</th>
              <th className="py-1.5 pr-3 font-medium">Provider</th>
              <th className="py-1.5 pr-3 font-medium">Fonte</th>
              <th className="py-1.5 pr-3 font-medium">Capacidades</th>
              {isAdmin && <th className="py-1.5 pr-3 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.code} className="border-t border-border/60">
                <td className="py-1.5 pr-3 font-sans text-foreground">{p.marketplaceCode}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{p.code}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{p.sourceType}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{p.capabilities.join(', ')}</td>
                {isAdmin && (
                  <td className="py-1.5 pr-3">
                    <Button variant="outline" size="sm" disabled={syncMutation.isPending} onClick={() => syncMutation.mutate(p.code)}>
                      Verificar agora
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {syncMutation.isSuccess && <p className="mt-2 text-xs font-medium text-margin-good">Sync disparado para {syncMutation.data.providerCode}.</p>}
      {syncMutation.isError && <p className="mt-2 text-xs font-medium text-margin-danger">{extractErrorMessage(syncMutation.error)}</p>}
    </Card>
  );
}

function CreateManualRuleForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [marketplaceCode, setMarketplaceCode] = useState('');
  const [ruleType, setRuleType] = useState<RuleType>('FEE_RULE');
  const [scopeKey, setScopeKey] = useState('');
  const [payloadJson, setPayloadJson] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(payloadJson);
        setJsonError(null);
      } catch {
        setJsonError('Payload precisa ser um JSON válido.');
        throw new Error('invalid-json');
      }
      return createManualRule({ marketplaceCode: marketplaceCode.trim(), ruleType, scopeKey: scopeKey.trim(), payload });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pending-rules'] });
      onDone();
    },
  });

  const canSubmit = marketplaceCode.trim() !== '' && scopeKey.trim() !== '';

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">Cadastro manual de regra</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          Canal (ex.: MERCADO_LIVRE)
          <input value={marketplaceCode} onChange={(e) => setMarketplaceCode(e.target.value.toUpperCase())} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Tipo de regra
          <select value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)} className={inputClass}>
            {RULE_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-foreground">
          Chave de escopo (ex.: categoria/SKU a que a regra se aplica)
          <input value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Payload (JSON)
          <input value={payloadJson} onChange={(e) => setPayloadJson(e.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button disabled={!canSubmit || createMutation.isPending} onClick={() => createMutation.mutate()}>
          {createMutation.isPending ? 'Criando…' : 'Cadastrar regra'}
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        {jsonError && <span className="text-xs font-medium text-margin-danger">{jsonError}</span>}
        {createMutation.isError && !jsonError && (
          <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(createMutation.error)}</span>
        )}
      </div>
    </Card>
  );
}

function PendingRulesSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const pendingQuery = useQuery({ queryKey: ['pending-rules'], queryFn: () => fetchPendingRules() });
  const pending = pendingQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pending-rules'] });
  const approveMutation = useMutation({ mutationFn: (id: string) => approveRule(id), onSuccess: invalidate });
  const rejectMutation = useMutation({ mutationFn: (id: string) => rejectRule(id), onSuccess: invalidate });
  const pinMutation = useMutation({ mutationFn: (id: string) => pinRule(id), onSuccess: invalidate });
  const unpinMutation = useMutation({ mutationFn: (id: string) => unpinRule(id), onSuccess: invalidate });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground">Regras pendentes de validação</h2>
          <p className="mt-1 text-xs text-muted-foreground">Aprovar/rejeitar regras coletadas automaticamente, ou fixar (pin) uma versão.</p>
        </div>
        {isAdmin && !showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            Cadastro manual
          </Button>
        )}
      </div>

      {showForm && (
        <div className="mt-3">
          <CreateManualRuleForm onDone={() => setShowForm(false)} />
        </div>
      )}

      {pendingQuery.isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>}
      {!pendingQuery.isLoading && pending.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nenhuma regra pendente.</p>}
      <div className="mt-3 space-y-3">
        {pending.map((rule) => (
          <Card key={rule.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-sans text-xs font-medium text-foreground">{rule.ruleType}</span>
                  <Badge variant="secondary">{rule.scopeKey}</Badge>
                  {rule.pinned && <Badge variant="accent">Fixada</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Fonte: {rule.sourceType} ({rule.sourceProviderCode}) · v{rule.version} · coletada em{' '}
                  {dateFormatter.format(new Date(rule.sourceFetchedAt))}
                </p>
              </div>
              {isAdmin && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(rule.id)}>
                    Aprovar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="hover:border-margin-danger hover:text-margin-danger"
                    disabled={rejectMutation.isPending}
                    onClick={() => rejectMutation.mutate(rule.id)}
                  >
                    Rejeitar
                  </Button>
                  {rule.pinned ? (
                    <Button variant="outline" size="sm" disabled={unpinMutation.isPending} onClick={() => unpinMutation.mutate(rule.id)}>
                      Desafixar
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled={pinMutation.isPending} onClick={() => pinMutation.mutate(rule.id)}>
                      Fixar
                    </Button>
                  )}
                </div>
              )}
            </div>
            <pre className="mt-2 overflow-x-auto rounded-md bg-secondary/40 p-2 text-xs text-foreground">{JSON.stringify(rule.payload, null, 2)}</pre>
          </Card>
        ))}
      </div>
      {(approveMutation.isError || rejectMutation.isError || pinMutation.isError || unpinMutation.isError) && (
        <p className="mt-2 text-xs font-medium text-margin-danger">
          {extractErrorMessage(approveMutation.error ?? rejectMutation.error ?? pinMutation.error ?? unpinMutation.error)}
        </p>
      )}
    </Card>
  );
}

function ChangeEventsSection() {
  const eventsQuery = useQuery({ queryKey: ['change-events'], queryFn: () => fetchChangeEvents(undefined, 50) });
  const events = eventsQuery.data ?? [];

  return (
    <Card className="p-5">
      <h2 className="font-serif text-lg font-semibold text-foreground">Histórico de mudanças</h2>
      <p className="mt-1 text-xs text-muted-foreground">Evolução das políticas dos marketplaces ao longo do tempo.</p>
      {eventsQuery.isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>}
      {!eventsQuery.isLoading && events.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nenhuma mudança registrada ainda.</p>}
      {events.length > 0 && (
        <ul className="mt-3 space-y-2">
          {events.map((e) => (
            <li key={e.id} className="border-t border-border/60 pt-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{e.changeSummary}</span>
                <Badge variant={e.resolutionStatus === 'AUTO_APPLIED' ? 'success' : e.resolutionStatus === 'REJECTED' ? 'danger' : 'secondary'}>
                  {e.resolutionStatus}
                </Badge>
              </div>
              <p className="mt-1 text-muted-foreground">
                {e.ruleType} · {e.scopeKey} · detectado por {e.detectedByProvider} em {dateFormatter.format(new Date(e.detectedAt))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Canais cujos custos alimentam o motor de preço. Lista fixa de propósito
// (e não derivada dos providers): um canal aparece aqui assim que o lojista
// PODE vender nele, mesmo antes de existir provider de taxa — é justamente
// nesses que a configuração manual mais importa.
const CHANNELS_WITH_COSTS = [
  { code: 'MERCADO_LIVRE', label: 'Mercado Livre' },
  { code: 'SHOPEE', label: 'Shopee' },
  { code: 'AMAZON', label: 'Amazon' },
  { code: 'MAGALU', label: 'Magalu' },
  { code: 'TIKTOK_SHOP', label: 'TikTok Shop' },
  { code: 'SHEIN', label: 'Shein' },
  { code: 'NUVEMSHOP', label: 'Nuvemshop' },
];

// Canais que cobram tarifa por item dispensada por plano — hoje só a
// Amazon ("Plano de vendas profissional", R$19/mês: quem assina não paga
// os R$2 por item vendido).
const CHANNELS_WITH_PLAN = new Set(['AMAZON']);

// Canais que dão desconto de frete por reputação do vendedor — hoje só o
// Mercado Livre (até 70% para reputação verde-escuro).
const CHANNELS_WITH_REPUTATION = new Set(['MERCADO_LIVRE']);

function ChannelCostsSection({ isEditor }: { isEditor: boolean }) {
  const queryClient = useQueryClient();
  const profilesQuery = useQuery({ queryKey: ['seller-profiles'], queryFn: fetchSellerProfiles });
  const warehousesQuery = useQuery({ queryKey: ['warehouses'], queryFn: fetchWarehouses });

  const profileMutation = useMutation({
    mutationFn: ({ channelCode, input }: { channelCode: string; input: Parameters<typeof updateSellerProfile>[1] }) =>
      updateSellerProfile(channelCode, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seller-profiles'] }),
  });

  const freightMutation = useMutation({
    mutationFn: ({ warehouseId, value }: { warehouseId: string; value: number }) =>
      updateWarehouseEstimatedFreight(warehouseId, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouses'] }),
  });

  const profileOf = (channelCode: string) =>
    profilesQuery.data?.find((p) => p.channelCode === channelCode) ?? {
      channelCode,
      professionalPlanActive: false,
      freightDiscountPct: 0,
    };

  const warehouseOf = (channelCode: string) =>
    warehousesQuery.data?.find((w) => w.type === 'VIRTUAL_FULL' && w.channelCode === channelCode);

  return (
    <Card className="p-5">
      <h2 className="font-serif text-lg font-semibold text-foreground">Custos do canal</h2>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
        O que <strong>você</strong> contratou em cada canal — diferente da tabela de taxas, que é importada do
        marketplace e vale para todo vendedor. Estes campos entram direto no cálculo do preço mínimo. Enquanto não
        forem preenchidos, o sistema assume o cenário mais conservador: paga tarifa por item e paga o frete cheio.
      </p>

      {(profilesQuery.isLoading || warehousesQuery.isLoading) && (
        <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>
      )}

      <div className="mt-4 space-y-3">
        {CHANNELS_WITH_COSTS.map((channel) => {
          const profile = profileOf(channel.code);
          const warehouse = warehouseOf(channel.code);
          const hasPlan = CHANNELS_WITH_PLAN.has(channel.code);
          const hasReputation = CHANNELS_WITH_REPUTATION.has(channel.code);

          return (
            <div key={channel.code} className="rounded-md border border-border/60 p-3">
              <div className="flex items-center justify-between">
                <span className="font-sans text-sm font-medium text-foreground">{channel.label}</span>
                {profile.professionalPlanActive && <Badge>Plano profissional</Badge>}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {hasPlan && (
                  <label className="flex items-start gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={!isEditor || profileMutation.isPending}
                      checked={profile.professionalPlanActive}
                      onChange={(e) =>
                        profileMutation.mutate({
                          channelCode: channel.code,
                          input: { professionalPlanActive: e.target.checked },
                        })
                      }
                    />
                    <span>
                      Plano de vendas profissional
                      <span className="mt-0.5 block text-muted-foreground">
                        Assinando (R$19/mês), a tarifa de R$2 por item deixa de entrar no preço.
                      </span>
                    </span>
                  </label>
                )}

                {hasReputation && (
                  <label className="text-xs text-foreground">
                    Desconto de frete por reputação (%)
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className={inputClass}
                      disabled={!isEditor}
                      defaultValue={Math.round(profile.freightDiscountPct * 100)}
                      onBlur={(e) => {
                        const pct = Number(e.target.value);
                        if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
                          // O backend trabalha em fração (0.7 = 70%) — a
                          // conversão vive só aqui, na borda da UI.
                          profileMutation.mutate({
                            channelCode: channel.code,
                            input: { freightDiscountPct: pct / 100 },
                          });
                        }
                      }}
                    />
                    <span className="mt-0.5 block text-muted-foreground">Até 70% para reputação verde-escuro.</span>
                  </label>
                )}

                <label className="text-xs text-foreground">
                  Frete médio estimado (R$)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputClass}
                    disabled={!isEditor || !warehouse}
                    defaultValue={warehouse?.estimatedFreightCost ?? 0}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (warehouse && Number.isFinite(value) && value >= 0) {
                        freightMutation.mutate({ warehouseId: warehouse.id, value });
                      }
                    }}
                  />
                  <span className="mt-0.5 block text-muted-foreground">
                    {warehouse
                      ? 'Só vira custo seu quando o canal transfere o frete (no ML, acima de R$79).'
                      : 'Disponível após a primeira sincronização deste canal.'}
                  </span>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {(profileMutation.isError || freightMutation.isError) && (
        <p className="mt-3 text-xs text-destructive">
          {extractErrorMessage(profileMutation.error ?? freightMutation.error)}
        </p>
      )}
    </Card>
  );
}

export default function MarketplaceGovernancePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">Governança Marketplace Intelligence</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Painel de revisão das regras de taxa/frete/categoria coletadas dos marketplaces — aprovar, rejeitar, fixar versões e acompanhar mudanças.
        </p>
      </div>

      <ChannelCostsSection isEditor={isAdmin || user?.role === 'PRICING_EDITOR'} />
      <ProvidersSection isAdmin={isAdmin} />
      <PendingRulesSection isAdmin={isAdmin} />
      <ChangeEventsSection />
    </div>
  );
}
