import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchProducts, type Product } from '../features/catalog/api';
import ProductForm from '../features/catalog/components/ProductForm';
import { fetchChannelListings } from '../features/channels/api';
import { averageChannelPrice, computeMarginStatus, grossMarginPct } from '../features/catalog/margin-status';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// `null` = fechado; `undefined` dentro do estado aberto = criação. Duas
// informações distintas ("está aberto?" e "editando quem?") num estado só,
// para não existir a combinação impossível de fechado-com-produto.
type FormState = { produto?: Product } | null;

export default function CatalogPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(null);
  const productsQuery = useQuery({ queryKey: ['products'], queryFn: fetchProducts });
  const listingsQuery = useQuery({ queryKey: ['channel-listings'], queryFn: fetchChannelListings });

  const products = productsQuery.data ?? [];
  const listings = listingsQuery.data ?? [];
  const isLoading = productsQuery.isLoading || listingsQuery.isLoading;

  const rows = products.map((product) => {
    const skuListings = listings.filter((l) => l.skuCode === product.skuCode);
    const avgPrice = averageChannelPrice(skuListings.map((l) => l.currentPrice));
    const marginPct = grossMarginPct(avgPrice, product.costPrice);
    const statusInfo = computeMarginStatus(marginPct, product.minimumMarginPct);
    return { product, avgPrice, marginPct, statusInfo, channelCount: skuListings.length };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Catálogo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Preço e margem aqui são a média simples entre os canais vinculados, sem taxa de gateway — para o cálculo
            fino por cenário, abra "Editar Precificação".
          </p>
        </div>
        <Button onClick={() => setForm({})}>Novo produto</Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Foto</th>
                <th className="px-5 py-3 font-medium">Produto</th>
                <th className="px-5 py-3 font-medium">SKU</th>
                <th className="px-5 py-3 font-medium">Custo</th>
                <th className="px-5 py-3 font-medium">Preço de venda médio</th>
                <th className="px-5 py-3 font-medium">Margem média</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">NCM</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando catálogo…
                  </td>
                </tr>
              )}

              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum produto ainda. Conecte o Olist em Integrações para importar o catálogo, ou rode o seed demo.
                  </td>
                </tr>
              )}

              {rows.map(({ product, avgPrice, marginPct, statusInfo }) => (
                <tr key={product.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3">
                    {product.photoUrls[0] ? (
                      <img src={product.photoUrls[0]} alt={product.name} className="h-10 w-10 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
                        sem foto
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 font-medium text-foreground">{product.name}</td>
                  <td className="px-5 py-3 font-sans text-foreground">{product.skuCode}</td>
                  <td className="px-5 py-3 font-sans text-foreground">{currency.format(product.costPrice)}</td>
                  <td className="px-5 py-3 font-sans text-foreground">
                    {avgPrice !== null ? currency.format(avgPrice) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-5 py-3 font-sans font-semibold text-foreground">
                    {marginPct !== null ? `${marginPct.toFixed(1)}%` : <span className="font-normal text-muted-foreground">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusInfo.badgeClass}`}>
                      {statusInfo.label}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {product.ncm ? (
                      <span className="font-sans text-foreground">{product.ncm}</span>
                    ) : (
                      // NCM ausente não é detalhe de cadastro: sem ele não há
                      // como classificar o produto para fins tributários, nem
                      // emitir NF-e, nem publicar anúncio.
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                        sem NCM
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setForm({ produto: product })}>
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => navigate(`/produtos/${product.id}`)}>
                        Precificação
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {form && <ProductForm produto={form.produto} onClose={() => setForm(null)} />}
    </div>
  );
}
