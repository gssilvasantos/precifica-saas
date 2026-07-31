import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  connectNuvemshop,
  disconnectNuvemshop,
  fetchNuvemshopStatus,
  syncNuvemshopNow,
} from '../api';
import { extractErrorMessage } from '../../../lib/extract-error-message';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// Nuvemshop usa "app privado" (storeId + access_token estático), sem OAuth2
// completo — mesma categoria de decisão do Olist V2 (ver README, Etapa 5).
// Por isso o fluxo aqui é um formulário local, diferente do redirect do
// Mercado Livre.
export function NuvemshopConnectionCard() {
  const queryClient = useQueryClient();
  const [storeId, setStoreId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const statusQuery = useQuery({ queryKey: ['nuvemshop-status'], queryFn: fetchNuvemshopStatus });

  const connectMutation = useMutation({
    mutationFn: () => connectNuvemshop(storeId, accessToken),
    onSuccess: () => {
      setStoreId('');
      setAccessToken('');
      void queryClient.invalidateQueries({ queryKey: ['nuvemshop-status'] });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectNuvemshop,
    onSuccess: () => {
      setSyncMessage(null);
      void queryClient.invalidateQueries({ queryKey: ['nuvemshop-status'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: syncNuvemshopNow,
    onSuccess: () => {
      setSyncMessage('Sincronização disparada — os produtos/variantes chegam em instantes.');
      void queryClient.invalidateQueries({ queryKey: ['nuvemshop-status'] });
    },
  });

  const status = statusQuery.data;
  const connected = Boolean(status?.connected && status.isActive);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    connectMutation.mutate();
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Nuvemshop</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Loja própria — vínculo de catálogo por SKU (`ChannelListing`) e simulador de margem com taxa de gateway.
          </p>
        </div>
        <ConnectionStatusBadge loading={statusQuery.isLoading} connected={connected} />
      </div>

      {status?.connected && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <InfoField label="Status" value={status.isActive ? 'Ativa' : 'Desativada'} />
          <InfoField
            label="Última sincronização"
            value={status.lastSyncedAt ? dateFormatter.format(new Date(status.lastSyncedAt)) : 'Ainda não sincronizou'}
          />
        </dl>
      )}

      {/* Mostra o motivo mesmo sem clicar em "Sincronizar agora" — cobre falha do
          scheduler automático, não só do clique manual (ver comentário no backend,
          ErpSyncOrchestrator/NuvemshopChannelListingSyncService.syncTenant). */}
      {status?.connected && status.lastSyncStatus === 'FAILED' && status.lastSyncError && (
        <p className="mt-3 rounded-md border border-margin-danger/30 bg-margin-danger/5 px-3 py-2 text-sm text-margin-danger">
          Última tentativa de sincronização falhou: {status.lastSyncError}
        </p>
      )}

      {!connected && (
        // autoComplete="off" no <form> + name específico/não-genérico + autoComplete
        // dedicado em cada campo + data-lpignore/data-1p-ignore/data-bwignore (LastPass/
        // 1Password/Bitwarden) — o navegador insistia em auto-preencher Store ID/Access
        // Token com login salvo não relacionado porque um <input type="password"> ao
        // lado de um <input type="text"> sem atributos é o padrão clássico de
        // "formulário de login" que o Chrome tenta casar com credenciais guardadas.
        <form onSubmit={handleSubmit} className="mt-4 space-y-3" autoComplete="off">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">Store ID</span>
              <input
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                placeholder="123456"
                required
                name="nuvemshop-store-id"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">Access Token</span>
              <input
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                type="password"
                placeholder="Token do app privado"
                required
                minLength={10}
                name="nuvemshop-access-token"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Gere em: Nuvemshop → Configurações → Meus Aplicativos → Criar app privado.
          </p>
          <Button type="submit" disabled={connectMutation.isPending}>
            {connectMutation.isPending ? 'Validando…' : 'Conectar Nuvemshop'}
          </Button>
          {connectMutation.isError && (
            <p className="text-sm text-margin-danger">{extractErrorMessage(connectMutation.error)}</p>
          )}
        </form>
      )}

      {connected && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
          </Button>
          <Button
            variant="outline"
            className="border-margin-danger/40 text-margin-danger hover:bg-margin-danger/10 hover:text-margin-danger"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
          >
            {disconnectMutation.isPending ? 'Desconectando…' : 'Desconectar'}
          </Button>
        </div>
      )}

      {syncMessage && <p className="mt-3 text-sm text-margin-good">{syncMessage}</p>}
      {syncMutation.isError && (
        <p className="mt-3 text-sm text-margin-danger">{extractErrorMessage(syncMutation.error)}</p>
      )}
    </Card>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-sans text-foreground">{value}</dd>
    </div>
  );
}
