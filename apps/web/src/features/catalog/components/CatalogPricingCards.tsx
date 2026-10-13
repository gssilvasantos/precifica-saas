import { useQuery } from '@tanstack/react-query';
import { simulateNuvemshopMargin } from '../../pricing/api';
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

  const simulateQuery = useQuery({
    queryKey: ['nuvemshop-simulate-mini', product.skuCode],
    queryFn: () => simulateNuvemshopMargin({ skuCode: product.skuCode, installments: 1, receivingWindowDays: 0 }),
    enabled: !!nuvemshopListing,
    retry: false,
  });

  const nuvemshopData: ChannelMiniPricingData | null = simulateQuery.data
    ? {
        price: simulateQuery.data.grossPrice,
        custoTotal: simulateQuery.data.grossPrice - simulateQuery.data.netMargin,
        marginPct: simulateQuery.data.netMarginPct,
        lucroRs: simulateQuery.data.netMargin,
      }
    : null;

  // Hoje só a Nuvemshop calcula de ponta a ponta (ChannelListing + regra de
  // taxa de gateway) — mesmo racional de ProductPricingPage.tsx. Quando
  // ML/Shopee tiverem o mesmo pipeline, entram aqui sem mudar esta estrutura.
  const dataByChannel: Record<string, ChannelMiniPricingData | null> = { NUVEMSHOP: nuvemshopData };

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
            isLoading={channel.code === 'NUVEMSHOP' && simulateQuery.isFetching}
            data={dataByChannel[channel.code] ?? null}
            disconnectedMessage={!channel.connected ? 'Aguardando integração — sem regra de taxa cadastrada' : undefined}
          />
        </RevealItem>
      ))}
    </Stagger>
  );
}
