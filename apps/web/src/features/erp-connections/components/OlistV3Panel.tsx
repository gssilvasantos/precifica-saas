import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disconnectOlistV3,
  fetchOlistV3AuthorizeUrl,
  fetchOlistV3Status,
  verifyOlistV3,
} from '../api';
import { extractErrorMessage } from '../../../lib/extract-error-message';
import { useAuth } from '../../auth/auth-context';
import { Button } from '../../../components/ui/button';
import { OlistV3VerifyResultView } from './OlistV3VerifyResultView';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function fmtDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : '—';
}

// Conexão OAuth2 com a API v3 do Olist (ADR 0003, fatia 1). Fica escondido
// enquanto a flag OLIST_V3_ENABLED estiver desligada no servidor — o status
// responde 200 com enabled:false. Ainda NÃO alimenta o sync: serve para
// conectar e conferir, em leitura, o que a v3 devolve para alguns SKUs.
export function OlistV3Panel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [skuInput, setSkuInput] = useState('');
  const [confirmandoDesconexao, setConfirmandoDesconexao] = useState(false);

  const statusQuery = useQuery({ queryKey: ['olist-v3-status'], queryFn: fetchOlistV3Status });

  const connectMutation = useMutation({
    mutationFn: fetchOlistV3AuthorizeUrl,
    // A tela de autorização é do Olist: redireciona o navegador inteiro.
    onSuccess: ({ authorizeUrl }) => {
      window.location.href = authorizeUrl;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectOlistV3,
    onSuccess: () => {
      verifyMutation.reset();
      void queryClient.invalidateQueries({ queryKey: ['olist-v3-status'] });
    },
  });

  const verifyMutation = useMutation({ mutationFn: verifyOlistV3 });

  const status = statusQuery.data;
  if (!status || !status.enabled) return null;

  const skus = skuInput
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const skusValidos = skus.length >= 1 && skus.length <= 3;

  function handleVerify(event: FormEvent) {
    event.preventDefault();
    if (skusValidos) verifyMutation.mutate(skus);
  }

  return (
    <section aria-labelledby="olist-v3-titulo" className="mt-6 border-t border-border pt-5">
      <h3 id="olist-v3-titulo" className="text-sm font-semibold text-foreground">
        API v3 do Olist (em teste)
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Conexão somente leitura, ainda sem efeito na sincronização do catálogo. Serve para conferir o que a v3 devolve.
      </p>

      {!status.configured && (
        <p role="status" className="mt-3 text-sm text-margin-warning">
          A flag está ligada, mas faltam as credenciais do aplicativo v3 no servidor (id, segredo e redirect).
        </p>
      )}

      {status.configured && !status.connected && (
        <div className="mt-3">
          <Button variant="outline" onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
            {connectMutation.isPending ? 'Abrindo o Olist…' : 'Conectar API v3'}
          </Button>
          {connectMutation.isError && (
            <p className="mt-2 text-sm text-margin-danger">{extractErrorMessage(connectMutation.error)}</p>
          )}
        </div>
      )}

      {status.connected && (
        <div className="mt-3 space-y-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Info label="Conectada em" value={fmtDate(status.connectedAt)} />
            <Info label="Token de acesso até" value={fmtDate(status.accessExpiresAt)} />
            <Info label="Renovação válida até" value={fmtDate(status.refreshExpiresAt)} />
          </dl>

          <form onSubmit={handleVerify} className="space-y-2">
            <label className="block text-sm sm:max-w-md">
              <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                SKUs para verificar (1 a 3, separados por vírgula)
              </span>
              <input
                value={skuInput}
                onChange={(e) => setSkuInput(e.target.value)}
                placeholder="RM0001, RM0001-1"
                maxLength={200}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <p className="text-xs text-muted-foreground">Cada verificação consome até 7 chamadas da cota do Olist.</p>
            {skuInput && !skusValidos && (
              <p className="text-sm text-margin-danger">Informe de 1 a 3 SKUs.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline" disabled={!skusValidos || verifyMutation.isPending}>
                {verifyMutation.isPending ? 'Verificando…' : 'Verificar na v3'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-margin-danger/40 text-margin-danger hover:bg-margin-danger/10 hover:text-margin-danger"
                onClick={() => setConfirmandoDesconexao(true)}
                disabled={disconnectMutation.isPending}
              >
                Desconectar v3
              </Button>
            </div>
            {verifyMutation.isError && (
              <p className="text-sm text-margin-danger">{extractErrorMessage(verifyMutation.error)}</p>
            )}
          </form>

          {confirmandoDesconexao && (
            <div
              role="alertdialog"
              aria-labelledby="olist-v3-desconectar-titulo"
              className="rounded-md border border-margin-danger/30 bg-margin-danger/5 px-3 py-3 text-sm"
            >
              <p id="olist-v3-desconectar-titulo" className="font-medium text-margin-danger">
                {user?.tenantName
                  ? `Desconectar a API v3 do Olist da conta “${user.tenantName}”?`
                  : 'Desconectar a API v3 do Olist desta conta?'}
              </p>
              <p className="mt-1 text-muted-foreground">
                Apaga só os tokens da v3. A conexão atual (v2) e o catálogo importado permanecem; reconectar exige
                autorizar de novo no Olist.
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
          {disconnectMutation.isError && (
            <p className="text-sm text-margin-danger">{extractErrorMessage(disconnectMutation.error)}</p>
          )}

          {verifyMutation.data && <OlistV3VerifyResultView result={verifyMutation.data} />}
        </div>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}
