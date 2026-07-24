import { Inject, Injectable } from '@nestjs/common';
import { AdsCapableProvider } from '../../../shared/contracts/marketplace-provider.contract';

export const ADS_CAPABLE_PROVIDERS = Symbol('ADS_CAPABLE_PROVIDERS');

// Registry multi-provider — mesmo padrão de OrderProviderRegistry/
// MarketplaceProviderRegistry: adicionar um canal novo de Ads (Shopee,
// TikTok...) é registrar mais um AdsCapableProvider no token
// ADS_CAPABLE_PROVIDERS (module), nunca alterar esta classe nem o
// AdsSyncOrchestrator/AdsInsightsService.
@Injectable()
export class AdsProviderRegistry {
  constructor(@Inject(ADS_CAPABLE_PROVIDERS) private readonly providers: AdsCapableProvider[]) {}

  getAll(): AdsCapableProvider[] {
    return this.providers;
  }

  findByCode(code: string): AdsCapableProvider | undefined {
    return this.providers.find((p) => p.code === code);
  }

  findByMarketplaceCode(marketplaceCode: string): AdsCapableProvider[] {
    const normalized = marketplaceCode.toUpperCase();
    return this.providers.filter((p) => p.marketplaceCode === normalized);
  }
}
