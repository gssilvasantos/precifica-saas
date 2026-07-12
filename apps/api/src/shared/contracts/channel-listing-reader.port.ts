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
