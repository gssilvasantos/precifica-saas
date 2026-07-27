import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchShopeeStatus,
  fetchShopeeAuthorizeUrl,
  disconnectShopee,
  testShopeeConnection,
} from '../api';
import type { ShopeeHandshakeResult } from '../api';
import { ConnectionStatusBadge } from '../../erp-connections/components/ConnectionStatusBadge';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// Integração Shopee Open Platform (27/07/2026) — mesmo padrão visual/de
// mutations do card do Mercado Livre em IntegracoesPage.tsx, mas
// componentizado à parte (mesmo racional de NuvemshopConnectionCard/
// OlistConnectionCard), já que aqui é o segundo canal com fluxo de redirect
// (diferente do formulário de token estático da Nuvemshop). Só a camada de
// conexão está pronta no backend — nenhum pedido/produto da Shopee ainda
// (ver README), então este card só cobre autorizar/testar/desconectar.
export function ShopeeConnectionCard() {
  const queryClient = useQueryClient();
  const [handshakeResult, setHandshakeResult] = useState<ShopeeHandshakeResult | null>(null);

  const statusQuery = useQuery({ queryKey: ['shopee-status'], queryFn: fetchShopeeStatus });

  const connectMutation = useMutation({
    mutationFn: fetchShopeeAuthorizeUrl,
    onSuccess: ({ authorizeUrl }) => {
      // Redireciona o navegador INTEIRO — a tela de autorização é da própria
      // Shopee, fora da nossa aplicação (ver shopee-connection.controller.ts,
      // endpoint `authorize`).
      window.location.href = authorizeUrl;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectShopee,
    onSuccess: () => {
      setHandshakeResult(null);
      void queryClient.invalidateQueries({ queryKey: ['shopee-status'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: testShopeeConnection,
    onSuccess: (result) => {
      setHandshakeResult(result);
      void queryClient.invalidateQueries({ queryKey: ['shopee-status'] });
    },
  });

  const status = statusQuery.data;
  const connected = Boolean(status?.connected && status.isActive);

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Shopee</h2>
          <p className="mt-1 text-sm text-ink-500">
            Assinatura HMAC-SHA256 com renovação automática de token (ver docs/auth-security.md, seção 9). Ainda só a
            camada de conexão — sincronização de pedidos chega em uma próxima etapa.
          </p>
        </div>
        <ConnectionStatusBadge loading={statusQuery.isLoading} connected={connected} />
      </div>

      {status?.connected && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <InfoField label="Shop ID" value={status.shopId ?? '—'} />
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
            {connectMutation.isPending ? 'Redirecionando…' : 'Conectar com Shopee'}
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
        <p className="mt-3 text-sm text-margin-danger">Falha ao testar a conexão — tente novamente em instantes.</p>
      )}
      {connectMutation.isError && (
        <p className="mt-3 text-sm text-margin-danger">
          Não foi possível iniciar o fluxo de conexão — confirme se sua conta tem papel de Admin.
        </p>
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

function HandshakeResultPanel({ result }: { result: ShopeeHandshakeResult }) {
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
          <li>Loja: {result.shopName ?? '—'}</li>
          <li>Status da loja: {result.shopStatus ?? '—'}</li>
          <li>Token renovado durante o teste: {result.tokenRefreshed ? 'sim' : 'não'}</li>
        </ul>
      ) : (
        <p className="mt-2 text-ink-700">{result.errorMessage}</p>
      )}
    </div>
  );
}
