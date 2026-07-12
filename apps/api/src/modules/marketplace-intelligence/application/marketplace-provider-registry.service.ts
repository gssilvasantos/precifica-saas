import { Inject, Injectable } from '@nestjs/common';
import {
  FeeRuleCapableProvider,
  MarketplaceProvider,
  PriceUpdateCapableProvider,
  isFeeRuleCapable,
  isPriceUpdateCapable,
} from '../../../shared/contracts/marketplace-provider.contract';

export const MARKETPLACE_PROVIDERS = Symbol('MARKETPLACE_PROVIDERS');

// Todo provider concreto (MercadoLivreFeeRuleProvider, e os futuros de outros
// canais) se registra aqui via o token MARKETPLACE_PROVIDERS no module — ver
// seção 12 do documento de arquitetura: adicionar marketplace novo nunca
// altera esta classe, só a lista de providers injetados.
@Injectable()
export class MarketplaceProviderRegistry {
  constructor(@Inject(MARKETPLACE_PROVIDERS) private readonly providers: MarketplaceProvider[]) {}

  getAll(): MarketplaceProvider[] {
    return this.providers;
  }

  findByCode(code: string): MarketplaceProvider | undefined {
    return this.providers.find((p) => p.code === code);
  }

  getFeeRuleProviders(marketplaceCode: string): FeeRuleCapableProvider[] {
    return this.providers.filter(
      (p): p is FeeRuleCapableProvider => p.marketplaceCode === marketplaceCode && isFeeRuleCapable(p),
    );
  }

  // Usado pelo PriceUpdateDispatcherService — é o "achar o provider certo"
  // que deixa o Pricing Engine livre de saber se o canal é Mercado Livre,
  // Shopee ou Nuvemshop (ver shared/contracts/price-update-dispatcher.port.ts).
  findPriceUpdateProvider(marketplaceCode: string): PriceUpdateCapableProvider | undefined {
    return this.providers.find(
      (p): p is PriceUpdateCapableProvider => p.marketplaceCode === marketplaceCode && isPriceUpdateCapable(p),
    );
  }
}
