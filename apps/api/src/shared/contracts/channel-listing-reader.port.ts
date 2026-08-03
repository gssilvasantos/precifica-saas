// Porta de leitura exposta pelo erp-integration (dono da tabela ChannelListing)
// — consumida pelo Pricing Intelligence para saber o preço vigente de um SKU
// num canal específico, sem depender da tabela Prisma diretamente.
export interface ChannelListingSummary {
  channelCode: string;
  externalId: string;
  currentPrice: number | null;
  url: string | null;
}

export interface ChannelListingReader {
  findBySku(tenantId: string, channelCode: string, skuCode: string): Promise<ChannelListingSummary | null>;

  // Direção INVERSA (01/08/2026): dado o id do anúncio no canal, qual SKU
  // ele representa. Necessária para o custo de Ads por item chegar ao
  // produto — a API do Mercado Livre entrega gasto por anúncio (MLBxxxx),
  // e é este vínculo que traduz isso para SKU.
  //
  // Recebe uma LISTA porque o consumidor (DRE de um período) resolve
  // dezenas de anúncios de uma vez; um a um seriam N queries para montar um
  // relatório. Anúncios sem vínculo simplesmente não aparecem no resultado.
  findSkusByExternalIds(
    tenantId: string,
    channelCode: string,
    externalIds: string[],
  ): Promise<{ externalId: string; skuCode: string }[]>;
}

// Irmã de ChannelListingReader, mas de ESCRITA (Fase 4, benchmark Tiny ERP —
// ver CHANNEL_LISTING_WRITER em tokens.ts para o racional completo). Só
// `upsert`: o vínculo SKU<->anúncio é sempre idempotente por
// (tenantId, channelCode, skuCode), nunca um create/update distintos.
export interface ChannelListingWriterInput {
  tenantId: string;
  skuCode: string;
  channelCode: string;
  externalId: string;
  currentPrice: number | null;
  url: string | null;
}

export interface ChannelListingWriter {
  upsert(input: ChannelListingWriterInput): Promise<void>;
}
