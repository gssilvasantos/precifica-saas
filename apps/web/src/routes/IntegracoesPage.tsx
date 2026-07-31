import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMercadoLivreStatus,
  fetchMercadoLivreAuthorizeUrl,
  disconnectMercadoLivre,
  testMercadoLivreConnection,
} from '../features/marketplace-connections/api';
import type { MercadoLivreHandshakeResult } from '../features/marketplace-connections/api';
import { NuvemshopConnectionCard } from '../features/erp-connections/components/NuvemshopConnectionCard';
import { OlistConnectionCard } from '../features/erp-connections/components/OlistConnectionCard';
import { ShopeeConnectionCard } from '../features/marketplace-connections/components/ShopeeConnectionCard';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// Fase de Conexão Real — tela do frontend para as 4 integrações de canal
// (Mercado Livre via OAuth2 e Shopee via HMAC-SHA256 — ambos
// autorizar/status/desconectar/testar por redirect — e Nuvemshop/Olist via
// formulário de token estático — conectar/status/desconectar/sincronizar),
// em vez de exigir curl (ver README, Etapa 5, Sprint 22 e 27/07/2026).
export default function IntegracoesPage() {
  const queryClient = useQueryClient();
  const [handshakeResult, setHandshakeResult] = useState<MercadoLivreHandshakeResult | null>(null);

  // Lê o resultado do redirect de volta do callback OAuth2/HMAC — cada canal
  // devolve `conectado=<canal>` ou `erro=<canal>` (mercado-livre-connection.controller.ts,
  // shopee-connection.controller.ts). Limpa o query param logo em seguida
  // (replace, sem empilhar no histórico) pra um F5 não reexibir o banner
  // indefinidamente.
  const [searchParams, setSearchParams] = useSearchParams();
  const callbackChannel = searchParams.get('conectado') ?? searchParams.get('erro');
  const callbackWasError = searchParams.has('erro');

  useEffect(() => {
    if (!callbackChannel) return;
    void queryClient.invalidateQueries({
      queryKey: callbackChannel === 'shopee' ? ['shopee-status'] : ['mercado-livre-status'],
    });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('conectado');
      next.delete('erro');
      return next;
    }, { replace: true });
    // Roda só uma vez, no mount — não queremos reagir a re-renders normais.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const callbackChannelLabel = callbackChannel === 'shopee' ? 'Shopee' : 'Mercado Livre';

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
        <h1 className="font-serif text-3xl font-semibold text-foreground">Integrações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecte suas contas de marketplace para o Kyneti ingerir pedidos reais e calcular o DRE automaticamente.
        </p>
      </div>

      {callbackChannel && (
        <div
          className={cn(
            'rounded-xl border p-4 text-sm',
            callbackWasError ? 'border-margin-danger/40 bg-margin-danger/10' : 'border-margin-good/40 bg-margin-good/10',
          )}
        >
          <p className={callbackWasError ? 'font-medium text-margin-danger' : 'font-medium text-margin-good'}>
            {callbackWasError
              ? `Não foi possível concluir a conexão com ${callbackChannelLabel} — tente novamente.`
              : `${callbackChannelLabel} conectado com sucesso.`}
          </p>
        </div>
      )}

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Mercado Livre</h2>
            <p className="mt-1 text-sm text-muted-foreground">
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
            <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
              {connectMutation.isPending ? 'Redirecionando…' : 'Conectar com Mercado Livre'}
            </Button>
          )}

          {connected && (
            <>
              <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
                {testMutation.isPending ? 'Testando conexão…' : 'Testar conexão'}
              </Button>
              <Button
                variant="outline"
                className="border-margin-danger/40 text-margin-danger hover:bg-margin-danger/10 hover:text-margin-danger"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? 'Desconectando…' : 'Desconectar'}
              </Button>
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
      </Card>

      <ShopeeConnectionCard />

      <NuvemshopConnectionCard />

      <OlistConnectionCard />
    </div>
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

function StatusBadge({ loading, connected }: { loading: boolean; connected: boolean }) {
  if (loading) {
    return <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Verificando…</span>;
  }
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
        connected ? 'bg-margin-good/15 text-margin-good' : 'bg-muted text-muted-foreground',
      )}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-margin-good' : 'bg-ink-500'}`} />
      {connected ? 'Conectado' : 'Desconectado'}
    </span>
  );
}

function HandshakeResultPanel({ result }: { result: MercadoLivreHandshakeResult }) {
  return (
    <div
      className={cn(
        'mt-4 rounded-xl border p-4 text-sm',
        result.success ? 'border-margin-good/40 bg-margin-good/10' : 'border-margin-danger/40 bg-margin-danger/10',
      )}
    >
      <p className={result.success ? 'font-medium text-margin-good' : 'font-medium text-margin-danger'}>
        {result.success ? 'Conexão testada com sucesso.' : 'Teste de conexão falhou.'}
      </p>
      {result.success ? (
        <ul className="mt-2 space-y-1 text-foreground">
          <li>Pedidos encontrados: {result.ordersFound}</li>
          <li>Token renovado durante o teste: {result.tokenRefreshed ? 'sim' : 'não'}</li>
          {result.sampleOrderId && <li>Exemplo de pedido: #{result.sampleOrderId}</li>}
        </ul>
      ) : (
        <p className="mt-2 text-foreground">{result.errorMessage}</p>
      )}
    </div>
  );
}
