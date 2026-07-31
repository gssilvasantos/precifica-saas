import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import {
  blockTeamMember,
  fetchTeam,
  inviteTeamMember,
  unblockTeamMember,
  updateTeamMember,
  type TeamMember,
} from '../features/team/api';
import type { UserRole } from '../features/auth/api';
import { ALL_MODULE_CODES, MODULE_LABEL, type ModuleCode } from '../lib/module-codes';
import { extractErrorMessage } from '../lib/extract-error-message';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  PRICING_EDITOR: 'Editor de preços',
  VIEWER: 'Visualização',
};

// Painel de Equipe (30/07/2026) — tenant-scoped, só o ADMIN da própria conta
// convida/edita/bloqueia colegas. Proteção real é o backend (RolesGuard +
// ModuleAccessGuard checam fresco a cada chamada); isto aqui é só UX.
export default function TeamPage() {
  const queryClient = useQueryClient();
  const [isInviting, setIsInviting] = useState(false);

  const teamQuery = useQuery({ queryKey: ['team'], queryFn: fetchTeam });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['team'] });

  const inviteMutation = useMutation({
    mutationFn: inviteTeamMember,
    onSuccess: () => {
      invalidate();
      setIsInviting(false);
    },
  });
  const updateMutation = useMutation({ mutationFn: (args: { id: string; input: Parameters<typeof updateTeamMember>[1] }) => updateTeamMember(args.id, args.input), onSuccess: invalidate });
  const blockMutation = useMutation({ mutationFn: blockTeamMember, onSuccess: invalidate });
  const unblockMutation = useMutation({ mutationFn: unblockTeamMember, onSuccess: invalidate });

  const members = teamQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Equipe</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Convide colaboradores para acessar esta conta e defina a quais módulos cada um tem acesso.
          </p>
        </div>
        {!isInviting && (
          <Button size="sm" onClick={() => setIsInviting(true)}>
            Convidar colaborador
          </Button>
        )}
      </div>

      {isInviting && (
        <InviteForm
          isSubmitting={inviteMutation.isPending}
          error={inviteMutation.error ? extractErrorMessage(inviteMutation.error) : null}
          onCancel={() => {
            inviteMutation.reset();
            setIsInviting(false);
          }}
          onSubmit={(input) => inviteMutation.mutate(input)}
        />
      )}

      {teamQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando equipe…</p>}

      <div className="space-y-3">
        {members.map((member) => (
          <MemberCard
            key={member.id}
            member={member}
            onSaveModules={(moduleAccess) => updateMutation.mutate({ id: member.id, input: { moduleAccess } })}
            onSaveRole={(role) => updateMutation.mutate({ id: member.id, input: { role } })}
            onBlock={() => blockMutation.mutate(member.id)}
            onUnblock={() => unblockMutation.mutate(member.id)}
            isSaving={updateMutation.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function InviteForm({
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: {
  onSubmit: (input: { name: string; email: string; password: string; role: UserRole; moduleAccess: ModuleCode[] }) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole>('PRICING_EDITOR');
  const [moduleAccess, setModuleAccess] = useState<ModuleCode[]>(ALL_MODULE_CODES);

  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && password.length >= 8;

  function toggleModule(code: ModuleCode) {
    setModuleAccess((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ name: name.trim(), email: email.trim(), password, role, moduleAccess });
  }

  return (
    <Card className="p-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome</label>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do colaborador"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">E-mail</label>
            <input
              type="email"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@empresa.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Senha inicial</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="mínimo 8 caracteres"
              />
              <button
                type="button"
                tabIndex={-1}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Papel</label>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              <option value="ADMIN">Administrador</option>
              <option value="PRICING_EDITOR">Editor de preços</option>
              <option value="VIEWER">Visualização</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium text-muted-foreground">
            Módulos liberados {role === 'ADMIN' && '(administrador sempre tem acesso total)'}
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            {ALL_MODULE_CODES.map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  disabled={role === 'ADMIN'}
                  checked={role === 'ADMIN' || moduleAccess.includes(code)}
                  onChange={() => toggleModule(code)}
                  className="h-4 w-4 rounded border-border accent-accent"
                />
                {MODULE_LABEL[code]}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-margin-danger">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Convidando…' : 'Convidar'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MemberCard({
  member,
  onSaveModules,
  onSaveRole,
  onBlock,
  onUnblock,
  isSaving,
}: {
  member: TeamMember;
  onSaveModules: (moduleAccess: ModuleCode[]) => void;
  onSaveRole: (role: UserRole) => void;
  onBlock: () => void;
  onUnblock: () => void;
  isSaving: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftModules, setDraftModules] = useState<ModuleCode[]>(member.moduleAccess);

  function toggleModule(code: ModuleCode) {
    setDraftModules((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{member.name}</span>
            <Badge variant={member.isActive ? 'success' : 'danger'}>{member.isActive ? 'Ativo' : 'Bloqueado'}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{member.email}</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
            value={member.role}
            onChange={(e) => onSaveRole(e.target.value as UserRole)}
            disabled={isSaving}
          >
            <option value="ADMIN">Administrador</option>
            <option value="PRICING_EDITOR">Editor de preços</option>
            <option value="VIEWER">Visualização</option>
          </select>

          <Button variant="outline" size="sm" onClick={() => setIsEditing((v) => !v)}>
            {isEditing ? 'Fechar' : 'Módulos'}
          </Button>

          {member.isActive ? (
            <Button variant="outline" size="sm" onClick={onBlock}>
              Bloquear
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onUnblock}>
              Reativar
            </Button>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="mt-4 border-t border-border pt-4">
          {member.role === 'ADMIN' ? (
            <p className="text-sm text-muted-foreground">Administrador sempre tem acesso a todos os módulos.</p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                {ALL_MODULE_CODES.map((code) => (
                  <label key={code} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={draftModules.includes(code)}
                      onChange={() => toggleModule(code)}
                      className="h-4 w-4 rounded border-border accent-accent"
                    />
                    {MODULE_LABEL[code]}
                  </label>
                ))}
              </div>
              <Button
                size="sm"
                className="mt-3"
                disabled={isSaving}
                onClick={() => {
                  onSaveModules(draftModules);
                  setIsEditing(false);
                }}
              >
                Salvar módulos
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
