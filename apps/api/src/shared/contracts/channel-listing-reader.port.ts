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
