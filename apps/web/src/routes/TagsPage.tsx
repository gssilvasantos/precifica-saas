import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  TAGGABLE_ENTITY_TYPES,
  assignTag,
  createTag,
  fetchTagAssignmentsForEntity,
  fetchTags,
  removeTag,
  unassignTag,
  type Tag,
  type TaggableEntityType,
} from '../features/tags/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { extractErrorMessage } from '../lib/extract-error-message';

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const ENTITY_TYPE_LABEL: Record<TaggableEntityType, string> = {
  PRODUCT: 'Produto',
  ORDER: 'Pedido',
  FIXED_EXPENSE: 'Despesa fixa',
  ACCOUNTS_PAYABLE: 'Conta a pagar',
};

function TagChip({ tag }: { tag: Tag }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ backgroundColor: tag.color ? `${tag.color}26` : undefined, color: tag.color ?? undefined }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color ?? '#94a3b8' }} />
      {tag.name}
    </span>
  );
}

function CreateTagForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#4f46e5');

  const createMutation = useMutation({
    mutationFn: () => createTag(name.trim(), color),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      onDone();
    },
  });

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">Nova tag</h3>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-foreground">
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={50} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Cor
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="mt-1 h-9 w-16 rounded-md border border-input" />
        </label>
        <Button disabled={name.trim() === '' || createMutation.isPending} onClick={() => createMutation.mutate()}>
          {createMutation.isPending ? 'Criando…' : 'Criar tag'}
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
      </div>
      {createMutation.isError && <p className="mt-2 text-xs font-medium text-margin-danger">{extractErrorMessage(createMutation.error)}</p>}
    </Card>
  );
}

function TagsListSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: fetchTags });
  const tags = tagsQuery.data ?? [];

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeTag(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tags'] }),
  });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground">Tags cadastradas</h2>
          <p className="mt-1 text-xs text-muted-foreground">Marcadores genéricos aplicáveis a Produtos, Pedidos, Despesas fixas e Contas a pagar.</p>
        </div>
        {canEdit && !showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            Nova tag
          </Button>
        )}
      </div>

      {showForm && (
        <div className="mt-3">
          <CreateTagForm onDone={() => setShowForm(false)} />
        </div>
      )}

      {tagsQuery.isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>}
      {!tagsQuery.isLoading && tags.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nenhuma tag cadastrada ainda.</p>}
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-1.5">
              <TagChip tag={tag} />
              {canEdit && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-margin-danger"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(tag.id)}
                  title="Excluir tag"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {removeMutation.isError && <p className="mt-2 text-xs font-medium text-margin-danger">{extractErrorMessage(removeMutation.error)}</p>}
    </Card>
  );
}

function AssignmentSection({ canEdit }: { canEdit: boolean }) {
  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: fetchTags });
  const tags = tagsQuery.data ?? [];

  const [tagId, setTagId] = useState('');
  const [entityType, setEntityType] = useState<TaggableEntityType>('PRODUCT');
  const [entityId, setEntityId] = useState('');

  const assignMutation = useMutation({ mutationFn: () => assignTag(tagId, entityType, entityId.trim()) });
  const unassignMutation = useMutation({ mutationFn: () => unassignTag(tagId, entityType, entityId.trim()) });

  const lookupQuery = useQuery({
    queryKey: ['tag-assignments', entityType, entityId],
    queryFn: () => fetchTagAssignmentsForEntity(entityType, entityId.trim()),
    enabled: entityId.trim() !== '',
  });
  const assignedTagIds = new Set((lookupQuery.data ?? []).map((a) => a.tagId));

  return (
    <Card className="p-5">
      <h2 className="font-serif text-lg font-semibold text-foreground">Atribuir tag a um registro</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Cole o ID do produto, pedido, despesa fixa ou conta a pagar (visto na respectiva tela) para marcar ou consultar as tags aplicadas.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-foreground">
          Tipo de registro
          <select value={entityType} onChange={(e) => setEntityType(e.target.value as TaggableEntityType)} className={inputClass}>
            {TAGGABLE_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {ENTITY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-foreground sm:col-span-2">
          ID do registro
          <input value={entityId} onChange={(e) => setEntityId(e.target.value)} className={inputClass} />
        </label>
      </div>

      {entityId.trim() !== '' && (
        <div className="mt-3">
          <p className="text-xs font-medium text-foreground">Tags atuais neste registro:</p>
          {lookupQuery.isLoading && <p className="mt-1 text-xs text-muted-foreground">Carregando…</p>}
          {!lookupQuery.isLoading && assignedTagIds.size === 0 && <p className="mt-1 text-xs text-muted-foreground">Nenhuma tag aplicada ainda.</p>}
          <div className="mt-1 flex flex-wrap gap-2">
            {tags
              .filter((t) => assignedTagIds.has(t.id))
              .map((t) => (
                <TagChip key={t.id} tag={t} />
              ))}
          </div>
        </div>
      )}

      {canEdit && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="text-xs font-medium text-foreground">
            Tag
            <select value={tagId} onChange={(e) => setTagId(e.target.value)} className={inputClass}>
              <option value="">Selecione…</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            disabled={tagId === '' || entityId.trim() === '' || assignMutation.isPending}
            onClick={() => assignMutation.mutate(undefined, { onSuccess: () => void lookupQuery.refetch() })}
          >
            Atribuir
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={tagId === '' || entityId.trim() === '' || unassignMutation.isPending}
            onClick={() => unassignMutation.mutate(undefined, { onSuccess: () => void lookupQuery.refetch() })}
          >
            Remover
          </Button>
          {(assignMutation.isError || unassignMutation.isError) && (
            <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(assignMutation.error ?? unassignMutation.error)}</span>
          )}
        </div>
      )}
    </Card>
  );
}

export default function TagsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">Tags</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Marcadores genéricos e coloridos, reaproveitáveis entre Produtos, Pedidos, Despesas fixas e Contas a pagar.
        </p>
      </div>

      <TagsListSection canEdit={canEdit} />
      <AssignmentSection canEdit={canEdit} />
    </div>
  );
}
