import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  blockTenant,
  blockUser,
  deleteTenant,
  fetchPlatformAdminTenants,
  unblockTenant,
  unblockUser,
  type PlatformAdminTenant,
} from '../features/platform-admin/api';
import { extractErrorMessage } from '../lib/extract-error-message';
import { useAuth } from '../features/auth/auth-context';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

// Cross-tenant de propósito — só renderiza pra quem tem
// user.isPlatformAdmin=true (checado em App.tsx/AppLayout antes de chegar
// aqui); a proteção real é o backend (PlatformAdminGuard, checa fresco no
// banco a cada chamada), isto aqui é só UX.
export default function PlatformAdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [deletingTenantId, setDeletingTenantId] = useState<string | null>(null);
  const [errorByTenant, setErrorByTenant] = useState<Record<string, string>>({});

  // Proteção real é o backend (PlatformAdminGuard, checa isPlatformAdmin
  // fresco no banco a cada chamada) — isto aqui só evita renderizar a tela
  // e disparar chamadas que vão retornar 403 de qualquer forma.
  const tenantsQuery = useQuery({
    queryKey: ['platform-admin', 'tenants'],
    queryFn: fetchPlatformAdminTenants,
    enabled: Boolean(user?.isPlatformAdmin),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['platform-admin', 'tenants'] });

  const blockTenantMutation = useMutation({ mutationFn: blockTenant, onSuccess: invalidate });
  const unblockTenantMutation = useMutation({ mutationFn: unblockTenant, onSuccess: invalidate });
  const blockUserMutation = useMutation({ mutationFn: blockUser, onSuccess: invalidate });
  const unblockUserMutation = useMutation({ mutationFn: unblockUser, onSuccess: invalidate });

  const deleteTenantMutation = useMutation({
    mutationFn: deleteTenant,
    onSuccess: () => {
      setDeletingTenantId(null);
      invalidate();
    },
    onError: (error, tenantId) => {
      setErrorByTenant((prev) => ({ ...prev, [tenantId]: extractErrorMessage(error) }));
    },
  });

  // Todos os hooks acima rodam sempre, em qualquer ordem, antes deste
  // retorno condicional — regra dos hooks do React (nunca colocar um hook
  // depois de um return antecipado).
  if (!user?.isPlatformAdmin) return <Navigate to="/catalogo" replace />;

  const tenants = tenantsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">Administração da Plataforma</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Todas as contas cadastradas no Kyneti — bloqueie o acesso de uma conta inteira ou exclua cadastros vazios
          (criados por engano, sem produto importado).
        </p>
      </div>

      {tenantsQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando contas…</p>}

      <div className="space-y-4">
        {tenants.map((tenant) => (
          <TenantCard
            key={tenant.id}
            tenant={tenant}
            isDeleting={deletingTenantId === tenant.id}
            deleteError={errorByTenant[tenant.id]}
            onBlockTenant={() => blockTenantMutation.mutate(tenant.id)}
            onUnblockTenant={() => unblockTenantMutation.mutate(tenant.id)}
            onStartDelete={() => {
              setErrorByTenant((prev) => ({ ...prev, [tenant.id]: '' }));
              setDeletingTenantId(tenant.id);
            }}
            onCancelDelete={() => setDeletingTenantId(null)}
            onConfirmDelete={() => deleteTenantMutation.mutate(tenant.id)}
            isDeletePending={deleteTenantMutation.isPending}
            onBlockUser={(userId) => blockUserMutation.mutate(userId)}
            onUnblockUser={(userId) => unblockUserMutation.mutate(userId)}
          />
        ))}
      </div>
    </div>
  );
}

function TenantCard({
  tenant,
  isDeleting,
  deleteError,
  onBlockTenant,
  onUnblockTenant,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  isDeletePending,
  onBlockUser,
  onUnblockUser,
}: {
  tenant: PlatformAdminTenant;
  isDeleting: boolean;
  deleteError?: string;
  onBlockTenant: () => void;
  onUnblockTenant: () => void;
  onStartDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  isDeletePending: boolean;
  onBlockUser: (userId: string) => void;
  onUnblockUser: (userId: string) => void;
}) {
  const canDelete = tenant.productCount === 0;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-lg font-semibold text-foreground">{tenant.name}</h2>
            <Badge variant={tenant.isActive ? 'success' : 'danger'}>{tenant.isActive ? 'Ativa' : 'Bloqueada'}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {tenant.document ? `CNPJ ${tenant.document} — ` : ''}
            criada em {dateFormatter.format(new Date(tenant.createdAt))} — {tenant.productCount} produto
            {tenant.productCount === 1 ? '' : 's'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {tenant.isActive ? (
            <Button
              variant="outline"
              size="sm"
              className="border-margin-danger/40 text-margin-danger hover:bg-margin-danger/10 hover:text-margin-danger"
              onClick={onBlockTenant}
            >
              Bloquear conta
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onUnblockTenant}>
              Reativar conta
            </Button>
          )}

          {!isDeleting && (
            <Button
              variant="outline"
              size="sm"
              disabled={!canDelete}
              title={canDelete ? undefined : 'Só é possível excluir contas sem produto cadastrado — use "Bloquear".'}
              className="hover:border-margin-danger hover:text-margin-danger"
              onClick={onStartDelete}
            >
              Excluir conta
            </Button>
          )}
        </div>
      </div>

      {isDeleting && (
        <div className="mt-4 rounded-lg border border-margin-danger/30 bg-margin-danger/5 p-3">
          <p className="text-sm text-foreground">
            Excluir <strong>{tenant.name}</strong> é definitivo — os usuários dessa conta perdem acesso
            imediatamente. Confirma?
          </p>
          {deleteError && <p className="mt-1 text-sm text-margin-danger">{deleteError}</p>}
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              className="bg-margin-danger text-white hover:bg-margin-danger/90"
              onClick={onConfirmDelete}
              disabled={isDeletePending}
            >
              {isDeletePending ? 'Excluindo…' : 'Confirmar exclusão'}
            </Button>
            <Button variant="outline" size="sm" onClick={onCancelDelete}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Usuário</th>
              <th className="py-2 pr-3 font-medium">E-mail</th>
              <th className="py-2 pr-3 font-medium">Papel</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {tenant.users.map((user) => (
              <tr key={user.id} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-3 text-foreground">
                  {user.name}
                  {user.isPlatformAdmin && (
                    <Badge variant="accent" className="ml-2">
                      admin da plataforma
                    </Badge>
                  )}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{user.email}</td>
                <td className="py-2 pr-3 text-foreground">{user.role}</td>
                <td className="py-2 pr-3">
                  <Badge variant={user.isActive ? 'success' : 'danger'}>{user.isActive ? 'Ativo' : 'Bloqueado'}</Badge>
                </td>
                <td className="py-2 pr-3 text-right">
                  {user.isActive ? (
                    <Button variant="outline" size="sm" onClick={() => onBlockUser(user.id)}>
                      Bloquear
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => onUnblockUser(user.id)}>
                      Reativar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
