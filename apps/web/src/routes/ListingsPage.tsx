import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import { fetchProducts, updateProductCategory } from '../features/catalog/api';
import { fetchListingPublications, fetchProductCategories, publishListing } from '../features/marketplace-publishing/api';
import { fetchChannelListings } from '../features/channels/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const channelDateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const channelCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Reestruturação Visual WowDash (13/10/2026) — a "Listagem por canal" pedida
// (tabela de anúncios sincronizados de cada marketplace, por SKU) não tinha
// uma tela própria: `ChannelListing` (GET /erp-integration/channel-listings)
// já é buscado no app, mas só como insumo de cálculo de preço médio no
// Catálogo/Precificação — nunca exibido como lista em si. Esta seção reusa
// o MESMO fetchChannelListings já existente (nenhum endpoint novo), filtrado
// pelo produto selecionado, como tabela real por SKU/canal.
function ChannelListingsSection({ skuCode }: { skuCode: string }) {
  const listingsQuery = useQuery({ queryKey: ['channel-listings'], queryFn: fetchChannelListings });
  const listings = (listingsQuery.data ?? []).filter((l) => l.skuCode === skuCode);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-foreground">Anúncios sincronizados por canal</h3>
        <span className="text-xs text-muted-foreground">SKU {skuCode}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-muted/50">
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 font-medium">Canal</th>
              <th className="px-5 py-3 font-medium">ID externo</th>
              <th className="px-5 py-3 font-medium">Preço atual</th>
              <th className="px-5 py-3 font-medium">Última sincronização</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {listingsQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                  Carregando anúncios…
                </td>
              </tr>
            )}
            {!listingsQuery.isLoading && listings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                  Nenhum anúncio sincronizado ainda para este SKU.
                </td>
              </tr>
            )}
            {listings.map((listing) => (
              <tr key={listing.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                <td className="px-5 py-3">
                  <Badge variant="secondary" className="normal-case">
                    {listing.channelCode}
                  </Badge>
                </td>
                <td className="px-5 py-3 font-sans text-foreground">{listing.externalId}</td>
                <td className="px-5 py-3 font-sans text-foreground">
                  {listing.currentPrice !== null ? channelCurrency.format(listing.currentPrice) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-5 py-3 font-sans text-muted-foreground">{channelDateFormatter.format(new Date(listing.lastSyncedAt))}</td>
                <td className="px-5 py-3 text-right">
                  {listing.url && (
                    <a href={listing.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent hover:underline">
                      Ver anúncio
                    </a>
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
        <h1 className="font-serif text-3xl font-semibold text-foreground">Listagens por Canal</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Escolha um produto para ver os anúncios sincronizados por canal, o histórico de publicações e criar um novo
          anúncio em um marketplace.
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

          <ChannelListingsSection skuCode={selectedProduct.skuCode} />

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
