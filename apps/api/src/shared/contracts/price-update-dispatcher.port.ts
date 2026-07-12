// A "regra de ouro" pedida: o Pricing Engine manda um comando ("atualize o
// preço deste anúncio para X") sem saber se o canal é Mercado Livre, Shopee
// ou Nuvemshop. Esta é a única porta que o Pricing Engine (Pricing
// Intelligence) vai conhecer para EXECUTAR um reprice — implementada pelo
// Marketplace Intelligence, que é quem sabe qual provider atende cada
// marketplaceCode (via MarketplaceProviderRegistry).
export interface PriceUpdateCommand {
  tenantId: string;
  marketplaceCode: string; // "MERCADO_LIVRE" | "SHOPEE" | "NUVEMSHOP" | ...
  skuCode: string;
  externalId: string; // id do anúncio/produto no canal (de ChannelListing)
  newPrice: number;
}

export interface PriceUpdateOutcome {
  success: boolean;
  externalId: string;
  appliedPrice?: number;
  message?: string;
}

export interface PriceUpdateDispatcher {
  // Nunca lança por "canal não suporta escrita" — isso é um resultado de
  // negócio (success: false + message), não uma exceção, porque o chamador
  // (repricing automático) precisa decidir o que fazer sem um try/catch por
  // canal. Só lança em erro de infraestrutura de verdade.
  dispatch(command: PriceUpdateCommand): Promise<PriceUpdateOutcome>;
}
