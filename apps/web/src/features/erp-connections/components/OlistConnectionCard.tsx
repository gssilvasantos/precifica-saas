import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { connectOlist, disconnectOlist, fetchOlistStatus, syncOlistNow, type OlistSyncStatus } from '../api';
import { extractErrorMessage } from '../../../lib/extract-error-message';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { useAuth } from '../../auth/auth-context';
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
  const { user } = useAuth();
  const [apiToken, setApiToken] = useState('');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [confirmandoDesconexao, setConfirmandoDesconexao] = useState(false);

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
      // O endpoint é SÍNCRONO: quando esta promessa resolve, o sync já
      // terminou. "disparada — atualizado em instantes" descrevia um trabalho
      // em background que não existe, e aparecia em verde mesmo quando o sync
      // tinha deixado o catálogo inteiro de fora.
      setSyncMessage('Sincronização concluída.');
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
      {status?.connected && status.lastSyncError && (
        <SyncResultNotice status={status.lastSyncStatus} detail={status.lastSyncError} />
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
            onClick={() => setConfirmandoDesconexao(true)}
            disabled={disconnectMutation.isPending}
          >
            {disconnectMutation.isPending ? 'Desconectando…' : 'Desconectar'}
          </Button>
        </div>
      )}

      {/* Confirmação NOMEANDO a conta (13/08/2026).
          A mesma pessoa administra mais de uma conta aqui, e o botão age sobre
          aquela em que a sessão está — que a tela não dizia em lugar nenhum.
          Já custou a desconexão da integração da conta errada. Regra do
          projeto: ação destrutiva diz O QUE será afetado. */}
      {confirmandoDesconexao && (
        <div
          role="alertdialog"
          aria-labelledby="confirmar-desconexao-titulo"
          className="mt-4 rounded-md border border-margin-danger/30 bg-margin-danger/5 px-3 py-3 text-sm"
        >
          <p id="confirmar-desconexao-titulo" className="font-medium text-margin-danger">
            {/* Sessão anterior a esta mudança não tem o nome salvo — nesse
                caso a pergunta é genérica, nunca um nome inventado. */}
            {user?.tenantName
              ? `Desconectar o Olist da conta “${user.tenantName}”?`
              : 'Desconectar o Olist desta conta?'}
          </p>
          <p className="mt-1 text-muted-foreground">
            O catálogo já importado permanece. O token fica guardado, então reconectar depois não exige gerá-lo de
            novo — mas a sincronização automática para até você reconectar.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="border-margin-danger/40 text-margin-danger hover:bg-margin-danger/10 hover:text-margin-danger"
              onClick={() => {
                setConfirmandoDesconexao(false);
                disconnectMutation.mutate();
              }}
            >
              Sim, desconectar
            </Button>
            <Button variant="outline" onClick={() => setConfirmandoDesconexao(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Verde só quando não há nada a avisar. Com pendência ou falha, quem
          fala é o SyncResultNotice acima — duas mensagens contraditórias na
          mesma tela é pior que nenhuma. */}
      {syncMessage && !status?.lastSyncError && (
        <p className="mt-3 text-sm text-margin-good">{syncMessage}</p>
      )}
      {syncMutation.isError && (
        <p className="mt-3 text-sm text-margin-danger">{extractErrorMessage(syncMutation.error)}</p>
      )}
    </Card>
  );
}

// Resultado da última sincronização, em três estados — não dois.
//
// Até 09/08/2026 este bloco só existia para FAILED. O backend escreve PARTIAL
// quando sincronizou mas parte do catálogo ficou de fora, com uma mensagem
// dizendo quantos SKUs entraram, quantos não, e por quê — e essa mensagem
// nunca chegava à tela: ficava só na coluna lastSyncError do banco. Um sync
// que deixou 1.803 produtos de fora aparecia para o usuário como sucesso.
//
// PARTIAL é aviso (âmbar), não erro (vermelho): houve importação, e a ação do
// usuário é diferente — corrigir cadastro no ERP, não reconectar a conta.
function SyncResultNotice({ status, detail }: { status: OlistSyncStatus | null; detail: string }) {
  const parcial = status === 'PARTIAL';

  // Nada é comunicado só por cor (.claude/rules/frontend.md): o rótulo diz o
  // estado por escrito, e o ícone tem aria-hidden por ser redundante.
  const rotulo = parcial
    ? 'Sincronização concluída com pendências:'
    : 'Última tentativa de sincronização falhou:';

  const cor = parcial
    ? 'border-margin-warning/30 bg-margin-warning/5 text-margin-warning'
    : 'border-margin-danger/30 bg-margin-danger/5 text-margin-danger';

  return (
    <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${cor}`} role="status">
      <p className="font-medium">{rotulo}</p>
      {/* whitespace-pre-line: o backend monta a mensagem em linhas (uma por
          motivo, com marcador •). Sem isto tudo colapsa num parágrafo só. */}
      <p className="mt-1 whitespace-pre-line break-words">{detail}</p>
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
