import { useQuery } from '@tanstack/react-query';
import { simulateNuvemshopMargin, simulateMercadoLivreMargin, simulateShopeeMargin } from '../../pricing/api';
import { CHANNELS } from '../../pricing/channels';
import type { ChannelListing } from '../../channels/api';
import type { Product } from '../api';
import { Stagger, RevealItem } from '../../../components/motion/Reveal';
import ChannelPricingMiniCard, { type ChannelMiniPricingData } from '../../pricing/ChannelPricingMiniCard';

interface Props {
  product: Product;
  listings: ChannelListing[];
}

// Conteúdo mostrado quando o usuário clica numa linha do Catálogo (pedido do
// usuário, 13/10/2026: "quando eu clicar em um produto... abaixo das
// informações do produto apareçam os cards [...] exatamente como no mazzei
// pro seller"). Um card por canal em que o SKU tem vínculo — mesmo critério
// do Mazzei (`MKT_ORDER.filter(m => item.m[m])`): canal sem ChannelListing
// pra este SKU nem aparece, em vez de mostrar um card vazio.
//
// Cenário fixo (1x, recebimento na hora, sem frete grátis) — esta é uma
// visão rápida por linha da listagem, não a tela de cenário completa
// (ProductPricingPage, que continua existindo e com os controles de
// parcela/recebimento/frete — chegue lá pelo menu "⋯ → Precificação").
export default function CatalogPricingCards({ product, listings }: Props) {
  const skuListings = listings.filter((l) => l.skuCode === product.skuCode);
  const nuvemshopListing = skuListings.find((l) => l.channelCode === 'NUVEMSHOP');
  const mercadoLivreListing = skuListings.find((l) => l.channelCode === 'MERCADO_LIVRE');
  const shopeeListing = skuListings.find((l) => l.channelCode === 'SHOPEE');

  const nuvemshopQuery = useQuery({
    queryKey: ['nuvemshop-simulate-mini', product.skuCode],
    queryFn: () => simulateNuvemshopMargin({ skuCode: product.skuCode, installments: 1, receivingWindowDays: 0 }),
    enabled: !!nuvemshopListing,
    retry: false,
  });

  // Mercado Livre e Shopee (13/10/2026) — mesmo padrão de query da
  // Nuvemshop acima, cada um com sua própria key/enabled, para um canal sem
  // vínculo não disparar chamada nem aparecer como "calculando".
  const mercadoLivreQuery = useQuery({
    queryKey: ['mercado-livre-simulate-mini', product.skuCode],
    queryFn: () => simulateMercadoLivreMargin({ skuCode: product.skuCode }),
    enabled: !!mercadoLivreListing,
    retry: false,
  });

  const shopeeQuery = useQuery({
    queryKey: ['shopee-simulate-mini', product.skuCode],
    queryFn: () => simulateShopeeMargin({ skuCode: product.skuCode }),
    enabled: !!shopeeListing,
    retry: false,
  });

  const toMiniData = (data: { grossPrice: number; netMargin: number; netMarginPct: number } | undefined): ChannelMiniPricingData | null =>
    data
      ? {
          price: data.grossPrice,
          custoTotal: data.grossPrice - data.netMargin,
          marginPct: data.netMarginPct,
          lucroRs: data.netMargin,
        }
      : null;

  const dataByChannel: Record<string, ChannelMiniPricingData | null> = {
    NUVEMSHOP: toMiniData(nuvemshopQuery.data),
    MERCADO_LIVRE: toMiniData(mercadoLivreQuery.data),
    SHOPEE: toMiniData(shopeeQuery.data),
  };

  const loadingByChannel: Record<string, boolean> = {
    NUVEMSHOP: nuvemshopQuery.isFetching,
    MERCADO_LIVRE: mercadoLivreQuery.isFetching,
    SHOPEE: shopeeQuery.isFetching,
  };

  // "sem regra validada" é um estado diferente de "canal não vinculado":
  // o simulador respondeu, só não achou MarketplaceRule com status VALIDADA
  // pra esse SKU ainda (ver feeRuleFound no backend) — normalmente porque a
  // regra está PENDENTE_VALIDACAO em /governanca-marketplace.
  const feeRuleMissingByChannel: Record<string, boolean> = {
    NUVEMSHOP: nuvemshopQuery.data?.feeRuleFound === false,
    MERCADO_LIVRE: mercadoLivreQuery.data?.feeRuleFound === false,
    SHOPEE: shopeeQuery.data?.feeRuleFound === false,
  };

  const bestChannelCode = Object.entries(dataByChannel)
    .filter((entry): entry is [string, ChannelMiniPricingData] => entry[1] !== null)
    .sort((a, b) => b[1].marginPct - a[1].marginPct)[0]?.[0];

  const visibleChannels = CHANNELS.filter((channel) => skuListings.some((l) => l.channelCode === channel.code));

  if (visibleChannels.length === 0) {
    return (
      <p className="px-4 py-4 text-center text-xs text-muted-foreground">
        Nenhum canal vinculado a este SKU ainda — vincule em Integrações para ver o preço por canal aqui.
      </p>
    );
  }

  return (
    <Stagger className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {visibleChannels.map((channel) => (
        <RevealItem key={channel.code}>
          <ChannelPricingMiniCard
            channel={channel}
            isBestMargin={channel.code === bestChannelCode}
            isLoading={loadingByChannel[channel.code] ?? false}
            data={dataByChannel[channel.code] ?? null}
            disconnectedMessage={
              !channel.connected
                ? 'Aguardando integração — sem regra de taxa cadastrada'
                : feeRuleMissingByChannel[channel.code]
                  ? 'Sem regra de comissão validada ainda — ver Governança de Marketplace'
                  : undefined
            }
          />
        </RevealItem>
      ))}
    </Stagger>
  );
}
