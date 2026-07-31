import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { connectOlist, disconnectOlist, fetchOlistStatus, syncOlistNow } from '../api';
import { extractErrorMessage } from '../../../lib/extract-error-message';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

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
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Olist (ERP)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
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

      {/* Mesmo racional do card da Nuvemshop — mostra o motivo mesmo sem clicar
          em "Sincronizar agora" (cobre falha do scheduler automático). */}
      {status?.connected && status.lastSyncStatus === 'FAILED' && status.lastSyncError && (
        <p className="mt-3 rounded-md border border-margin-danger/30 bg-margin-danger/5 px-3 py-2 text-sm text-margin-danger">
          Última tentativa de sincronização falhou: {status.lastSyncError}
        </p>
      )}

      {!connected && (
        // Mesmo fix de autofill do card da Nuvemshop (ver comentário lá) —
        // autoComplete="off" no form + autoComplete="new-password" no campo +
        // data-lpignore/1p-ignore/bwignore para os gerenciadores de senha de terceiros.
        <form onSubmit={handleSubmit} className="mt-4 space-y-3" autoComplete="off">
          <label className="block text-sm sm:max-w-sm">
            <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">Token da API (Olist V2)</span>
            <input
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              type="password"
              placeholder="Token gerado no painel do Olist"
              required
              minLength={10}
              name="olist-api-token"
              autoComplete="new-password"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <p className="text-xs text-muted-foreground">Gere em: Olist Tiny → Configurações → Preferências → Chave da API.</p>
          <Button type="submit" disabled={connectMutation.isPending}>
            {connectMutation.isPending ? 'Validando…' : 'Conectar Olist'}
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
