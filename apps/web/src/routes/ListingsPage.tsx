import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import { fetchProducts, updateProductCategory } from '../features/catalog/api';
import { fetchListingPublications, fetchProductCategories, publishListing } from '../features/marketplace-publishing/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const MARKETPLACE_OPTIONS = ['MERCADO_LIVRE', 'SHOPEE'];

function StatusBadge({ status }: { status: 'PENDENTE' | 'PUBLICADO' | 'ERRO' }) {
  if (status === 'PUBLICADO') return <Badge variant="success">Publicado</Badge>;
  if (status === 'ERRO') return <Badge variant="danger">Erro</Badge>;
  return <Badge variant="secondary">Pendente</Badge>;
}

function CategoryPicker({ productId, categoryId, canEdit }: { productId: string; categoryId: string | null; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(categoryId ?? '');
  const categoriesQuery = useQuery({ queryKey: ['product-categories'], queryFn: () => fetchProductCategories() });
  const categories = categoriesQuery.data ?? [];

  const setMutation = useMutation({
    mutationFn: () => updateProductCategory(productId, value === '' ? null : value),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  if (!canEdit && categoryId) {
    const current = categories.find((c) => c.id === categoryId);
    return <p className="text-xs text-muted-foreground">Categoria: {current?.name ?? categoryId}</p>;
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-medium text-foreground">
        Categoria interna do produto
        <select value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} disabled={!canEdit}>
          <option value="">Sem categoria</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {canEdit && value !== (categoryId ?? '') && (
        <Button size="sm" disabled={setMutation.isPending} onClick={() => setMutation.mutate()}>
          Salvar categoria
        </Button>
      )}
      {setMutation.isError && <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(setMutation.error)}</span>}
    </div>
  );
}

function PublishForm({ skuCode, canEdit, onPublished }: { skuCode: string; canEdit: boolean; onPublished: () => void }) {
  const [marketplaceCode, setMarketplaceCode] = useState(MARKETPLACE_OPTIONS[0]);
  const [price, setPrice] = useState('');
  const [availableQuantity, setAvailableQuantity] = useState('');
  const [overrideAttributesJson, setOverrideAttributesJson] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const publishMutation = useMutation({
    mutationFn: () => {
      let overrideAttributes: Record<string, string> | undefined;
      try {
        overrideAttributes = JSON.parse(overrideAttributesJson);
        setJsonError(null);
      } catch {
        setJsonError('Atributos precisam ser um JSON válido (ex.: {"Cor": "Azul"}).');
        throw new Error('invalid-json');
      }
      return publishListing({
        skuCode,
        marketplaceCode,
        price: Number(price),
        availableQuantity: Number(availableQuantity),
        overrideAttributes,
      });
    },
    onSuccess: onPublished,
  });

  const canSubmit = Number(price) > 0 && Number(availableQuantity) >= 0;

  if (!canEdit) return null;

  return (
    <Card className="p-4">
      <h4 className="text-sm font-semibold text-foreground">Publicar anúncio novo</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Ação manual e definitiva — cria um anúncio real no canal. Exige categoria interna mapeada para este canal (ver Categorias e Publicação),
        foto e peso já cadastrados no produto.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          Canal
          <select value={marketplaceCode} onChange={(e) => setMarketplaceCode(e.target.value)} className={inputClass}>
            {MARKETPLACE_OPTIONS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-foreground">
          Preço
          <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Quantidade disponível
          <input type="number" min={0} value={availableQuantity} onChange={(e) => setAvailableQuantity(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Atributos extras (JSON, opcional)
          <input value={overrideAttributesJson} onChange={(e) => setOverrideAttributesJson(e.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={!canSubmit || publishMutation.isPending} onClick={() => publishMutation.mutate()}>
          {publishMutation.isPending ? 'Publicando…' : 'Publicar anúncio'}
        </Button>
        {jsonError && <span className="text-xs font-medium text-margin-danger">{jsonError}</span>}
        {publishMutation.isError && !jsonError && (
          <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(publishMutation.error)}</span>
        )}
      </div>
    </Card>
  );
}

export default function ListingsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const [productId, setProductId] = useState('');
  const productsQuery = useQuery({ queryKey: ['products'], queryFn: fetchProducts });
  const products = productsQuery.data ?? [];
  const selectedProduct = products.find((p) => p.id === productId) ?? null;

  const publicationsQuery = useQuery({
    queryKey: ['listing-publications', productId],
    queryFn: () => fetchListingPublications(productId),
    enabled: productId !== '',
  });
  const publications = publicationsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">Publicar Anúncio Novo</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Escolha um produto para ver o histórico de publicações e criar um novo anúncio em um marketplace.
        </p>
      </div>

      <Card className="p-5">
        <label className="text-xs font-medium text-foreground">
          Produto
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputClass}>
            <option value="">Selecione um produto…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.skuCode} — {p.name}
              </option>
            ))}
          </select>
        </label>
      </Card>

      {selectedProduct && (
        <>
          <Card className="p-5">
            <CategoryPicker productId={selectedProduct.id} categoryId={selectedProduct.categoryId} canEdit={canEdit} />
          </Card>

          <PublishForm
            skuCode={selectedProduct.skuCode}
            canEdit={canEdit}
            onPublished={() => void publicationsQuery.refetch()}
          />

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Histórico de publicações</h3>
            {publicationsQuery.isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
            {!publicationsQuery.isLoading && publications.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma tentativa de publicação ainda para este produto.</p>
            )}
            {publications.map((pub) => (
              <Card key={pub.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-xs font-medium text-foreground">{pub.marketplaceCode}</span>
                    <StatusBadge status={pub.status} />
                  </div>
                  <span className="text-xs text-muted-foreground">{dateFormatter.format(new Date(pub.requestedAt))}</span>
                </div>
                {pub.externalListingId && <p className="mt-1 text-xs text-muted-foreground">ID do anúncio no canal: {pub.externalListingId}</p>}
                {pub.errorMessage && <p className="mt-1 text-xs font-medium text-margin-danger">{pub.errorMessage}</p>}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
