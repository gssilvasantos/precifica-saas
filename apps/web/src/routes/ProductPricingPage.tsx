import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchProducts, type Product } from '../features/catalog/api';
import { fetchChannelListings } from '../features/channels/api';
import { simulateNuvemshopMargin } from '../features/pricing/api';
import { CHANNELS } from '../features/pricing/channels';
import ProductPricingCard, { type ChannelPricingData } from '../features/pricing/ProductPricingCard';

const RECEIVING_WINDOWS = [
  { label: 'Na hora', days: 0 },
  { label: 'Em 14 dias', days: 14 },
  { label: 'Em 30 dias', days: 30 },
];
const INSTALLMENT_OPTIONS = [1, 2, 3, 6, 10, 12];

export default function ProductPricingPage() {
  // productId vem da rota (/produtos/:productId) quando chega pelo botão
  // "Editar Precificação" do Catálogo — sem param, cai no primeiro produto
  // (comportamento antigo, útil para acesso direto via menu).
  const { productId } = useParams<{ productId?: string }>();
  const navigate = useNavigate();

  const productsQuery = useQuery({ queryKey: ['products'], queryFn: fetchProducts });
  const listingsQuery = useQuery({ queryKey: ['channel-listings'], queryFn: fetchChannelListings });

  const [installments, setInstallments] = useState(1);
  const [receivingWindowDays, setReceivingWindowDays] = useState(0);
  const [freeShipping, setFreeShipping] = useState(false);
  const [estimatedShippingCost, setEstimatedShippingCost] = useState(0);
  const [couponCost, setCouponCost] = useState(0);

  const products = productsQuery.data ?? [];
  const selected: Product | undefined = useMemo(
    () => products.find((p) => p.id === productId) ?? products[0],
    [products, productId],
  );

  // Sem :productId na URL (ex.: acesso via menu lateral) mas já sabemos qual
  // produto vamos mostrar (o primeiro) — normaliza a URL para refletir isso,
  // assim o link fica compartilhável/atualizável (F5) desde o primeiro render.
  useEffect(() => {
    if (!productId && selected) {
      navigate(`/produtos/${selected.id}`, { replace: true });
    }
  }, [productId, selected, navigate]);

  const nuvemshopListing = listingsQuery.data?.find(
    (l) => l.channelCode === 'NUVEMSHOP' && l.skuCode === selected?.skuCode,
  );

  const simulateQuery = useQuery({
    queryKey: ['nuvemshop-simulate', selected?.skuCode, installments, receivingWindowDays, freeShipping, estimatedShippingCost, couponCost],
    queryFn: () =>
      simulateNuvemshopMargin({
        skuCode: selected!.skuCode,
        installments,
        receivingWindowDays,
        freeShipping,
        estimatedShippingCost,
        couponCost,
      }),
    enabled: !!selected && !!nuvemshopListing,
    retry: false,
  });

  const nuvemshopData: ChannelPricingData | null = simulateQuery.data
    ? {
        grossPrice: simulateQuery.data.grossPrice,
        costPrice: simulateQuery.data.costPrice,
        marginPct: simulateQuery.data.netMarginPct,
        feeLabel: `Taxa de gateway (${installments}x, recebimento em ${receivingWindowDays}d): ${simulateQuery.data.gatewayFeePct.toFixed(1)}%`,
        feeRuleFound: simulateQuery.data.feeRuleFound,
      }
    : null;

  // Melhor margem entre os canais com dado REAL — hoje só Nuvemshop calcula
  // de ponta a ponta, mas a comparação já é genérica: quando ML/Shopee
  // tiverem ChannelListing + FeeRuleResolver funcionando, entram aqui sem
  // mudar esta lógica.
  const marginsByChannel: Record<string, number | null> = { NUVEMSHOP: nuvemshopData?.marginPct ?? null };
  const bestChannelCode = Object.entries(marginsByChannel)
    .filter(([, pct]) => pct !== null)
    .sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="rounded-2xl bg-surface p-4 shadow-card">
        <Link to="/catalogo" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-gold">
          ← Voltar ao catálogo
        </Link>
        <h2 className="mb-3 font-serif text-lg font-semibold text-ink-900">Produtos</h2>
        {productsQuery.isLoading && <p className="text-sm text-ink-500">Carregando…</p>}
        <ul className="space-y-1">
          {products.map((product) => (
            <li key={product.id}>
              <button
                onClick={() => navigate(`/produtos/${product.id}`)}
                className={[
                  'w-full rounded-lg px-3 py-2 text-left text-sm transition',
                  selected?.id === product.id ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-canvas',
                ].join(' ')}
              >
                <span className="block font-medium">{product.name}</span>
                <span className="block text-xs opacity-70">{product.skuCode}</span>
              </button>
            </li>
          ))}
        </ul>
        {!productsQuery.isLoading && products.length === 0 && (
          <p className="text-sm text-ink-500">
            Nenhum produto ainda. Conecte o Olist em Integrações para importar o catálogo.
          </p>
        )}
      </aside>

      <main>
        {!selected ? (
          <div className="flex h-full items-center justify-center rounded-2xl bg-surface p-10 text-ink-500 shadow-card">
            Selecione um produto para ver a precificação por canal.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start gap-5 rounded-2xl bg-surface p-6 shadow-card">
              {selected.photoUrls[0] ? (
                <img src={selected.photoUrls[0]} alt={selected.name} className="h-24 w-24 rounded-xl object-cover" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-canvas text-xs text-ink-500">
                  sem foto
                </div>
              )}
              <div>
                <h1 className="font-serif text-3xl font-semibold text-ink-900">{selected.name}</h1>
                <p className="mt-1 font-sans text-sm text-ink-500">
                  SKU <span className="font-semibold text-ink-700">{selected.skuCode}</span> · Custo{' '}
                  <span className="font-semibold text-ink-700">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(selected.costPrice)}
                  </span>{' '}
                  · Estoque <span className="font-semibold text-ink-700">{selected.stockQuantity}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4 rounded-2xl bg-surface p-5 shadow-card">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">Parcelas</label>
                <select
                  value={installments}
                  onChange={(e) => setInstallments(Number(e.target.value))}
                  className="rounded-lg border border-ink-300 px-3 py-1.5 text-sm"
                >
                  {INSTALLMENT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}x
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">
                  Recebimento
                </label>
                <select
                  value={receivingWindowDays}
                  onChange={(e) => setReceivingWindowDays(Number(e.target.value))}
                  className="rounded-lg border border-ink-300 px-3 py-1.5 text-sm"
                >
                  {RECEIVING_WINDOWS.map((w) => (
                    <option key={w.days} value={w.days}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" checked={freeShipping} onChange={(e) => setFreeShipping(e.target.checked)} />
                Frete grátis (loja absorve)
              </label>
              {freeShipping && (
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">
                    Custo estimado do frete
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={estimatedShippingCost}
                    onChange={(e) => setEstimatedShippingCost(Number(e.target.value))}
                    className="w-28 rounded-lg border border-ink-300 px-3 py-1.5 text-sm"
                  />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">
                  Cupom/desconto absorvido
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={couponCost}
                  onChange={(e) => setCouponCost(Number(e.target.value))}
                  className="w-28 rounded-lg border border-ink-300 px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {CHANNELS.map((channel) => (
                <ProductPricingCard
                  key={channel.code}
                  channel={channel}
                  isBestMargin={channel.code === bestChannelCode}
                  isLoading={channel.code === 'NUVEMSHOP' && simulateQuery.isFetching}
                  data={channel.code === 'NUVEMSHOP' ? nuvemshopData : null}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
