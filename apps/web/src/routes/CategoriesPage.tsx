import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  createProductCategory,
  fetchCategoryAttributes,
  fetchCategoryMappings,
  fetchExternalCategoryAttributes,
  fetchProductCategories,
  removeCategoryAttribute,
  removeCategoryMapping,
  removeProductCategory,
  searchExternalCategories,
  setCategoryAttribute,
  setCategoryMapping,
  updateProductCategoryNode,
  type ExternalCategoryCandidate,
  type ProductCategory,
} from '../features/marketplace-publishing/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { extractErrorMessage } from '../lib/extract-error-message';

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const MARKETPLACE_OPTIONS = ['MERCADO_LIVRE', 'SHOPEE'];

function AttributesSection({ categoryId, canEdit }: { categoryId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [attributeName, setAttributeName] = useState('');
  const [attributeValue, setAttributeValue] = useState('');
  const [extendToChildren, setExtendToChildren] = useState(false);

  const attributesQuery = useQuery({ queryKey: ['category-attributes', categoryId], queryFn: () => fetchCategoryAttributes(categoryId) });
  const attributes = attributesQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['category-attributes', categoryId] });
  const setMutation = useMutation({
    mutationFn: () => setCategoryAttribute(categoryId, { attributeName: attributeName.trim(), attributeValue: attributeValue.trim(), extendToChildren }),
    onSuccess: () => {
      invalidate();
      setAttributeName('');
      setAttributeValue('');
      setExtendToChildren(false);
    },
  });
  const removeMutation = useMutation({ mutationFn: (name: string) => removeCategoryAttribute(categoryId, name), onSuccess: invalidate });

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-foreground">Atributos herdados</h4>
      {attributes.length === 0 && <p className="text-xs text-muted-foreground">Nenhum atributo definido para esta categoria.</p>}
      {attributes.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Atributo</th>
              <th className="py-1 pr-3 font-medium">Valor</th>
              <th className="py-1 pr-3 font-medium">Estende p/ filhas</th>
              {canEdit && <th className="py-1 pr-3 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {attributes.map((a) => (
              <tr key={a.id} className="border-t border-border/60">
                <td className="py-1 pr-3 font-sans text-foreground">{a.attributeName}</td>
                <td className="py-1 pr-3 font-sans text-foreground">{a.attributeValue}</td>
                <td className="py-1 pr-3 font-sans text-foreground">{a.extendToChildren ? 'Sim' : 'Não'}</td>
                {canEdit && (
                  <td className="py-1 pr-3">
                    <Button variant="outline" size="sm" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate(a.attributeName)}>
                      Remover
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div className="grid gap-2 sm:grid-cols-3">
          <input placeholder="Nome (ex.: Cor)" value={attributeName} onChange={(e) => setAttributeName(e.target.value)} className={inputClass} />
          <input placeholder="Valor (ex.: Azul)" value={attributeValue} onChange={(e) => setAttributeValue(e.target.value)} className={inputClass} />
          <div className="mt-1 flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <input type="checkbox" checked={extendToChildren} onChange={(e) => setExtendToChildren(e.target.checked)} />
              Estender p/ filhas
            </label>
            <Button
              size="sm"
              disabled={attributeName.trim() === '' || attributeValue.trim() === '' || setMutation.isPending}
              onClick={() => setMutation.mutate()}
            >
              Salvar
            </Button>
          </div>
        </div>
      )}
      {setMutation.isError && <p className="text-xs font-medium text-margin-danger">{extractErrorMessage(setMutation.error)}</p>}
    </div>
  );
}

function ChannelMappingSection({ categoryId, canEdit }: { categoryId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [marketplaceCode, setMarketplaceCode] = useState(MARKETPLACE_OPTIONS[0]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ExternalCategoryCandidate | null>(null);

  const mappingsQuery = useQuery({ queryKey: ['category-mappings', categoryId], queryFn: () => fetchCategoryMappings(categoryId) });
  const mappings = mappingsQuery.data ?? [];

  const searchMutation = useMutation({ mutationFn: () => searchExternalCategories(marketplaceCode, query.trim()) });
  const attributesQuery = useQuery({
    queryKey: ['external-category-attributes', marketplaceCode, selected?.externalCategoryId],
    queryFn: () => fetchExternalCategoryAttributes(marketplaceCode, selected!.externalCategoryId),
    enabled: !!selected,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['category-mappings', categoryId] });
  const saveMutation = useMutation({
    mutationFn: () =>
      setCategoryMapping({
        categoryId,
        marketplaceCode,
        externalCategoryId: selected!.externalCategoryId,
        externalCategoryName: selected!.name,
      }),
    onSuccess: () => {
      invalidate();
      setSelected(null);
      setQuery('');
    },
  });
  const removeMutation = useMutation({ mutationFn: (id: string) => removeCategoryMapping(id), onSuccess: invalidate });

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h4 className="text-xs font-semibold text-foreground">Mapeamento para canais</h4>
      {mappings.length === 0 && <p className="text-xs text-muted-foreground">Nenhum mapeamento configurado ainda.</p>}
      {mappings.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Canal</th>
              <th className="py-1 pr-3 font-medium">Categoria no canal</th>
              {canEdit && <th className="py-1 pr-3 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.id} className="border-t border-border/60">
                <td className="py-1 pr-3 font-sans text-foreground">{m.marketplaceCode}</td>
                <td className="py-1 pr-3 font-sans text-foreground">{m.externalCategoryName}</td>
                {canEdit && (
                  <td className="py-1 pr-3">
                    <Button variant="outline" size="sm" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate(m.id)}>
                      Remover
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium text-foreground">
              Canal
              <select
                value={marketplaceCode}
                onChange={(e) => {
                  setMarketplaceCode(e.target.value);
                  setSelected(null);
                }}
                className={inputClass}
              >
                {MARKETPLACE_OPTIONS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-1 text-xs font-medium text-foreground">
              Buscar categoria no canal
              <input value={query} onChange={(e) => setQuery(e.target.value)} className={inputClass} />
            </label>
            <Button size="sm" disabled={query.trim() === '' || searchMutation.isPending} onClick={() => searchMutation.mutate()}>
              Buscar
            </Button>
          </div>
          {searchMutation.isError && <p className="text-xs font-medium text-margin-danger">{extractErrorMessage(searchMutation.error)}</p>}
          {searchMutation.data && searchMutation.data.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma categoria encontrada.</p>}
          {searchMutation.data && searchMutation.data.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {searchMutation.data.map((c) => (
                <li key={c.externalCategoryId}>
                  <button
                    type="button"
                    onClick={() => setSelected(c)}
                    className={`w-full rounded px-2 py-1 text-left text-xs ${selected?.externalCategoryId === c.externalCategoryId ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/10'}`}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selected && (
            <div className="rounded-md border border-border bg-secondary/30 p-2">
              <p className="text-xs text-foreground">
                Selecionado: <strong>{selected.name}</strong>
              </p>
              {attributesQuery.data && attributesQuery.data.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Atributos exigidos pelo canal: {attributesQuery.data.map((a) => `${a.name}${a.required ? ' (obrigatório)' : ''}`).join(', ')}
                </p>
              )}
              <Button size="sm" className="mt-2" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? 'Salvando…' : 'Salvar mapeamento'}
              </Button>
              {saveMutation.isError && <p className="mt-1 text-xs font-medium text-margin-danger">{extractErrorMessage(saveMutation.error)}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryForm({ categories, onDone }: { categories: ProductCategory[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [parentCategoryId, setParentCategoryId] = useState('');

  const createMutation = useMutation({
    mutationFn: () => createProductCategory({ name: name.trim(), parentCategoryId: parentCategoryId === '' ? undefined : parentCategoryId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      onDone();
    },
  });

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">Nova categoria</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Categoria pai (opcional)
          <select value={parentCategoryId} onChange={(e) => setParentCategoryId(e.target.value)} className={inputClass}>
            <option value="">Nenhuma (raiz)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button disabled={name.trim() === '' || createMutation.isPending} onClick={() => createMutation.mutate()}>
          {createMutation.isPending ? 'Criando…' : 'Criar categoria'}
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        {createMutation.isError && <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(createMutation.error)}</span>}
      </div>
    </Card>
  );
}

function CategoryRow({ category, categories, canEdit }: { category: ProductCategory; categories: ProductCategory[]; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);

  const parent = categories.find((c) => c.id === category.parentCategoryId);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['product-categories'] });
  const updateMutation = useMutation({
    mutationFn: () => updateProductCategoryNode(category.id, { name: name.trim() }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });
  const removeMutation = useMutation({ mutationFn: () => removeProductCategory(category.id), onSuccess: invalidate });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {editing ? (
            <div className="flex items-center gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              <Button size="sm" disabled={name.trim() === '' || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
                Salvar
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setEditing(false); setName(category.name); }}>
                Cancelar
              </Button>
            </div>
          ) : (
            <h3 className="font-serif text-base font-semibold text-foreground">
              {category.name}
              {parent && <span className="ml-2 text-xs font-normal text-muted-foreground">em {parent.name}</span>}
            </h3>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Ocultar detalhes' : 'Ver detalhes'}
          </Button>
          {canEdit && !editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Editar
            </Button>
          )}
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="hover:border-margin-danger hover:text-margin-danger"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate()}
            >
              Excluir
            </Button>
          )}
        </div>
      </div>
      {(updateMutation.isError || removeMutation.isError) && (
        <p className="mt-2 text-xs font-medium text-margin-danger">{extractErrorMessage(updateMutation.error ?? removeMutation.error)}</p>
      )}
      {expanded && (
        <div className="mt-3 space-y-4 border-t border-border pt-3">
          <AttributesSection categoryId={category.id} canEdit={canEdit} />
          <ChannelMappingSection categoryId={category.id} canEdit={canEdit} />
        </div>
      )}
    </Card>
  );
}

export default function CategoriesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const [showForm, setShowForm] = useState(false);
  const categoriesQuery = useQuery({ queryKey: ['product-categories'], queryFn: () => fetchProductCategories() });
  const categories = categoriesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Categorias e Publicação</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Árvore de categorias, atributos herdados e mapeamento para a categoria de cada marketplace — pré-requisito para publicar um anúncio novo.
          </p>
        </div>
        {canEdit && !showForm && <Button onClick={() => setShowForm(true)}>Nova categoria</Button>}
      </div>

      {showForm && <CategoryForm categories={categories} onDone={() => setShowForm(false)} />}

      <div className="space-y-3">
        {categoriesQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!categoriesQuery.isLoading && categories.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>}
        {categories.map((category) => (
          <CategoryRow key={category.id} category={category} categories={categories} canEdit={canEdit} />
        ))}
      </div>
    </div>
  );
}
