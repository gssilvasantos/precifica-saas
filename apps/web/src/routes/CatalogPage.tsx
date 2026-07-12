import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchProducts } from '../features/catalog/api';
import { fetchChannelListings } from '../features/channels/api';
import { averageChannelPrice, computeMarginStatus, grossMarginPct } from '../features/catalog/margin-status';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CatalogPage() {
  const navigate = useNavigate();
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
      <div>
        <h1 className="font-serif text-3xl font-semibold text-ink-900">Catálogo</h1>
        <p className="mt-1 text-sm text-ink-500">
          Preço e margem aqui são a média simples entre os canais vinculados, sem taxa de gateway — para o cálculo
          fino por cenário, abra "Editar Precificação".
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink-300/60 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-5 py-3 font-medium">Foto</th>
              <th className="px-5 py-3 font-medium">Produto</th>
              <th className="px-5 py-3 font-medium">SKU</th>
              <th className="px-5 py-3 font-medium">Custo</th>
              <th className="px-5 py-3 font-medium">Preço de venda médio</th>
              <th className="px-5 py-3 font-medium">Margem média</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-ink-500">
                  Carregando catálogo…
                </td>
              </tr>
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-ink-500">
                  Nenhum produto ainda. Conecte o Olist em Integrações para importar o catálogo, ou rode o seed demo.
                </td>
              </tr>
            )}

            {rows.map(({ product, avgPrice, marginPct, statusInfo }) => (
              <tr key={product.id} className="border-b border-ink-300/30 last:border-0 hover:bg-canvas/60">
                <td className="px-5 py-3">
                  {product.photoUrls[0] ? (
                    <img src={product.photoUrls[0]} alt={product.name} className="h-10 w-10 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-canvas text-[10px] text-ink-500">
                      sem foto
                    </div>
                  )}
                </td>
                <td className="px-5 py-3 font-medium text-ink-900">{product.name}</td>
                <td className="px-5 py-3 font-sans text-ink-700">{product.skuCode}</td>
                <td className="px-5 py-3 font-sans text-ink-700">{currency.format(product.costPrice)}</td>
                <td className="px-5 py-3 font-sans text-ink-700">
                  {avgPrice !== null ? currency.format(avgPrice) : <span className="text-ink-500">—</span>}
                </td>
                <td className="px-5 py-3 font-sans font-semibold text-ink-900">
                  {marginPct !== null ? `${marginPct.toFixed(1)}%` : <span className="font-normal text-ink-500">—</span>}
                </td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusInfo.badgeClass}`}>
                    {statusInfo.label}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={() => navigate(`/produtos/${product.id}`)}
                    className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-gold hover:text-gold"
                  >
                    Editar Precificação
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
