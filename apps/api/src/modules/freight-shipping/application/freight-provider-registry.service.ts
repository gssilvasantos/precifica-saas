import { Inject, Injectable } from '@nestjs/common';
import { FREIGHT_LABEL_PROVIDERS, FreightLabelProvider } from './freight-label-provider.contract';

// Mesmo racional de ListingProviderRegistry (marketplace-publishing) e
// OrderProviderRegistry: lookup por código, nunca um if/else espalhado pelo
// resto do módulo.
@Injectable()
export class FreightProviderRegistry {
  constructor(@Inject(FREIGHT_LABEL_PROVIDERS) private readonly providers: FreightLabelProvider[]) {}

  findByProviderCode(providerCode: string): FreightLabelProvider | undefined {
    const code = providerCode.toUpperCase();
    return this.providers.find((p) => p.providerCode.toUpperCase() === code);
  }
}
