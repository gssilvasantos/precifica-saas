import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { connectOlist, disconnectOlist, fetchOlistStatus, syncOlistNow } from '../api';
import { extractErrorMessage } from '../../../lib/extract-error-message';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// Olist Tiny é a fonte única da verdade do catálogo (ver README, Etapa 5) —
// diferente de Mercado Livre/Nuvemshop, que são canais de venda. O Kyneti só
// LÊ do Olist (nunca escreve de volta): importa e mantém sincronizado
// SKU/nome/preço/estoque, para que o usuário nunca precise cadastrar produto
// manualmente. Token estático da API V2, não OAuth2.
export function OlistConnectionCard() {
  const queryClient = useQueryClient();
  const [apiToken, setApiToken] = useState('');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const statusQuery = useQuery({ queryKey: ['olist-status'], queryFn: fetchOlistStatus });

  const connectMutation = useMutation({
    mutationFn: () => connectOlist(apiToken),
    onSuccess: () => {
      setApiToken('');
      void queryClient.invalidateQueries({ queryKey: ['olist-status'] });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectOlist,
    onSuccess: () => {
      setSyncMessage(null);
      void queryClient.invalidateQueries({ queryKey: ['olist-status'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: syncOlistNow,
    onSuccess: () => {
      setSyncMessage('Sincronização disparada — o catálogo é atualizado em instantes.');
      void queryClient.invalidateQueries({ queryKey: ['olist-status'] });
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
          <h2 className="text-lg font-semibold text-ink-900">Olist (ERP)</h2>
          <p className="mt-1 text-sm text-ink-500">
            Fonte única da verdade do catálogo — importa e mantém produtos sincronizados, sem cadastro manual.
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
          <label className="block text-sm sm:max-w-sm">
            <span className="mb-1 block text-xs uppercase tracking-wide text-ink-500">Token da API (Olist V2)</span>
            <input
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              type="password"
              placeholder="Token gerado no painel do Olist"
              required
              minLength={10}
              className="w-full rounded-lg border border-ink-300 bg-transparent px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold"
            />
          </label>
          <p className="text-xs text-ink-500">Gere em: Olist Tiny → Configurações → Preferências → Chave da API.</p>
          <button
            type="submit"
            disabled={connectMutation.isPending}
            className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-700 disabled:opacity-50"
          >
            {connectMutation.isPending ? 'Validando…' : 'Conectar Olist'}
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
