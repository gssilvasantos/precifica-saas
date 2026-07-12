import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMercadoLivreStatus,
  fetchMercadoLivreAuthorizeUrl,
  disconnectMercadoLivre,
  testMercadoLivreConnection,
} from '../features/marketplace-connections/api';
import type { MercadoLivreHandshakeResult } from '../features/marketplace-connections/api';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// Fase de Conexão Real — primeira tela do frontend para o fluxo de OAuth2 do
// Mercado Livre de verdade (autorizar/status/desconectar/testar), em vez de
// exigir curl (ver README, Etapa 5 e Sprint 22). Nuvemshop segue API-only
// por enquanto — ver card "próximo passo" abaixo, honesto sobre o que ainda
// não tem tela própria.
export default function IntegracoesPage() {
  const queryClient = useQueryClient();
  const [handshakeResult, setHandshakeResult] = useState<MercadoLivreHandshakeResult | null>(null);

  const statusQuery = useQuery({
    queryKey: ['mercado-livre-status'],
    queryFn: fetchMercadoLivreStatus,
  });

  const connectMutation = useMutation({
    mutationFn: fetchMercadoLivreAuthorizeUrl,
    onSuccess: ({ authorizeUrl }) => {
      // Redireciona o navegador INTEIRO — a tela de autorização é do próprio
      // Mercado Livre, fora da nossa aplicação (ver
      // mercado-livre-connection.controller.ts, endpoint `authorize`).
      window.location.href = authorizeUrl;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectMercadoLivre,
    onSuccess: () => {
      setHandshakeResult(null);
      void queryClient.invalidateQueries({ queryKey: ['mercado-livre-status'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: testMercadoLivreConnection,
    onSuccess: (result) => {
      setHandshakeResult(result);
      void queryClient.invalidateQueries({ queryKey: ['mercado-livre-status'] });
    },
  });

  const status = statusQuery.data;
  const connected = Boolean(status?.connected && status.isActive);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-ink-900">Integrações</h1>
        <p className="mt-1 text-sm text-ink-500">
          Conecte suas contas de marketplace para o Kyneti ingerir pedidos reais e calcular o DRE automaticamente.
        </p>
      </div>

      <div className="rounded-2xl bg-surface p-6 shadow-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">Mercado Livre</h2>
            <p className="mt-1 text-sm text-ink-500">
              OAuth2 com renovação automática de token (ver docs/auth-security.md).
            </p>
          </div>
          <StatusBadge loading={statusQuery.isLoading} connected={connected} />
        </div>

        {status?.connected && (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <InfoField label="Seller ID" value={status.sellerId ?? '—'} />
            <InfoField label="Expira em" value={status.expiresAt ? dateFormatter.format(new Date(status.expiresAt)) : '—'} />
            <InfoField
              label="Última renovação"
              value={status.lastRefreshedAt ? dateFormatter.format(new Date(status.lastRefreshedAt)) : 'Nunca'}
            />
            <InfoField label="Status" value={status.isActive ? 'Ativa' : 'Desativada'} />
          </dl>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {!connected && (
            <button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-700 disabled:opacity-50"
            >
              {connectMutation.isPending ? 'Redirecionando…' : 'Conectar com Mercado Livre'}
            </button>
          )}

          {connected && (
            <>
              <button
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-gold hover:text-gold disabled:opacity-50"
              >
                {testMutation.isPending ? 'Testando conexão…' : 'Testar conexão'}
              </button>
              <button
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                className="rounded-lg border border-margin-danger/40 px-4 py-2 text-sm font-medium text-margin-danger transition hover:bg-margin-danger/10 disabled:opacity-50"
              >
                {disconnectMutation.isPending ? 'Desconectando…' : 'Desconectar'}
              </button>
            </>
          )}
        </div>

        {handshakeResult && <HandshakeResultPanel result={handshakeResult} />}
        {testMutation.isError && (
          <p className="mt-3 text-sm text-margin-danger">
            Falha ao testar a conexão — tente novamente em instantes.
          </p>
        )}
        {connectMutation.isError && (
          <p className="mt-3 text-sm text-margin-danger">
            Não foi possível iniciar o fluxo de conexão — confirme se sua conta tem papel de Admin.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-dashed border-ink-300/60 bg-surface/60 p-6">
        <h2 className="text-sm font-semibold text-ink-700">Nuvemshop</h2>
        <p className="mt-1 text-sm text-ink-500">
          Conectar via token estático, ver status e disparar sincronização já funcionam via API (ver README, Etapa
          5) — a tela dedicada para fazer isso sem curl é o próximo passo do frontend.
        </p>
      </div>
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

function StatusBadge({ loading, connected }: { loading: boolean; connected: boolean }) {
  if (loading) {
    return <span className="rounded-full bg-ink-300/40 px-3 py-1 text-xs font-medium text-ink-700">Verificando…</span>;
  }
  return (
    <span
      className={[
        'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
        connected ? 'bg-margin-good/15 text-margin-good' : 'bg-ink-300/40 text-ink-700',
      ].join(' ')}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-margin-good' : 'bg-ink-500'}`} />
      {connected ? 'Conectado' : 'Desconectado'}
    </span>
  );
}

function HandshakeResultPanel({ result }: { result: MercadoLivreHandshakeResult }) {
  return (
    <div
      className={[
        'mt-4 rounded-xl border p-4 text-sm',
        result.success ? 'border-margin-good/40 bg-margin-good/10' : 'border-margin-danger/40 bg-margin-danger/10',
      ].join(' ')}
    >
      <p className={result.success ? 'font-medium text-margin-good' : 'font-medium text-margin-danger'}>
        {result.success ? 'Conexão testada com sucesso.' : 'Teste de conexão falhou.'}
      </p>
      {result.success ? (
        <ul className="mt-2 space-y-1 text-ink-700">
          <li>Pedidos encontrados: {result.ordersFound}</li>
          <li>Token renovado durante o teste: {result.tokenRefreshed ? 'sim' : 'não'}</li>
          {result.sampleOrderId && <li>Exemplo de pedido: #{result.sampleOrderId}</li>}
        </ul>
      ) : (
        <p className="mt-2 text-ink-700">{result.errorMessage}</p>
      )}
    </div>
  );
}
