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
    <div className="rounded-2xl bg-surface p-6 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Nuvemshop</h2>
          <p className="mt-1 text-sm text-ink-500">
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

      {!connected && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wide text-ink-500">Store ID</span>
              <input
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                placeholder="123456"
                required
                className="w-full rounded-lg border border-ink-300 bg-transparent px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wide text-ink-500">Access Token</span>
              <input
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                type="password"
                placeholder="Token do app privado"
                required
                minLength={10}
                className="w-full rounded-lg border border-ink-300 bg-transparent px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold"
              />
            </label>
          </div>
          <p className="text-xs text-ink-500">
            Gere em: Nuvemshop → Configurações → Meus Aplicativos → Criar app privado.
          </p>
          <button
            type="submit"
            disabled={connectMutation.isPending}
            className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-700 disabled:opacity-50"
          >
            {connectMutation.isPending ? 'Validando…' : 'Conectar Nuvemshop'}
          </button>
          {connectMutation.isError && (
            <p className="text-sm text-margin-danger">{extractErrorMessage(connectMutation.error)}</p>
          )}
        </form>
      )}

      {connected && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-gold hover:text-gold disabled:opacity-50"
          >
            {syncMutation.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>
          <button
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
            className="rounded-lg border border-margin-danger/40 px-4 py-2 text-sm font-medium text-margin-danger transition hover:bg-margin-danger/10 disabled:opacity-50"
          >
            {disconnectMutation.isPending ? 'Desconectando…' : 'Desconectar'}
          </button>
        </div>
      )}

      {syncMessage && <p className="mt-3 text-sm text-margin-good">{syncMessage}</p>}
      {syncMutation.isError && (
        <p className="mt-3 text-sm text-margin-danger">{extractErrorMessage(syncMutation.error)}</p>
      )}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 font-sans text-ink-900">{value}</dd>
    </div>
  );
}
