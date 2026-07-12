import { Inject, Injectable } from '@nestjs/common';
import { OrderCapableProvider } from '../../../shared/contracts/marketplace-provider.contract';

export const ORDER_CAPABLE_PROVIDERS = Symbol('ORDER_CAPABLE_PROVIDERS');

// Registry multi-provider — mesmo padrão de MarketplaceProviderRegistry/
// CompetitionRadarRegistry/SettlementParserRegistry: adicionar um canal novo
// (ML, Shopee...) é registrar mais um OrderCapableProvider no token
// ORDER_CAPABLE_PROVIDERS (module), nunca alterar esta classe nem o
// OrderSyncOrchestrator.
@Injectable()
export class OrderProviderRegistry {
  constructor(@Inject(ORDER_CAPABLE_PROVIDERS) private readonly providers: OrderCapableProvider[]) {}

  getAll(): OrderCapableProvider[] {
    return this.providers;
  }

  findByCode(code: string): OrderCapableProvider | undefined {
    return this.providers.find((p) => p.code === code);
  }

  // Sprint 21 — endereçamento por CANAL (marketplaceCode, ex. "NUVEMSHOP"),
  // não por código interno de provider (ex. "NUVEMSHOP_ORDERS"). É o que
  // permite ao endpoint público de webhook (WebhooksController,
  // POST /webhooks/:channel) usar um nome estável e amigável — o mesmo que
  // o lojista configuraria no painel do marketplace — sem vazar o
  // `provider.code` interno. Case-insensitive: o path param chega como o
  // usuário digitou (ex. "nuvemshop"), o registro usa o marketplaceCode
  // canônico em maiúsculas.
  findByMarketplaceCode(marketplaceCode: string): OrderCapableProvider[] {
    const normalized = marketplaceCode.toUpperCase();
    return this.providers.filter((p) => p.marketplaceCode === normalized);
  }
}
