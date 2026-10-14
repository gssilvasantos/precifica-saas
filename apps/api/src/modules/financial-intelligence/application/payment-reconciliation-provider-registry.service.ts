import { Inject, Injectable } from '@nestjs/common';
import { PaymentReconciliationCapableProvider } from '../../../shared/contracts/marketplace-provider.contract';

export const PAYMENT_RECONCILIATION_PROVIDERS = Symbol('PAYMENT_RECONCILIATION_PROVIDERS');

// Registry multi-provider — mesmo padrão de OrderProviderRegistry/
// MarketplaceProviderRegistry/SettlementParserRegistry: adicionar um canal
// novo com conciliação de pagamento é registrar mais um
// PaymentReconciliationCapableProvider no token
// PAYMENT_RECONCILIATION_PROVIDERS (financial-intelligence.module.ts),
// nunca alterar esta classe nem ChannelPaymentReconciliationOrchestrator.
@Injectable()
export class PaymentReconciliationProviderRegistry {
  constructor(
    @Inject(PAYMENT_RECONCILIATION_PROVIDERS) private readonly providers: PaymentReconciliationCapableProvider[],
  ) {}

  findByCode(code: string): PaymentReconciliationCapableProvider | undefined {
    return this.providers.find((p) => p.code === code);
  }

  // Endereçamento por CANAL — mesmo racional de
  // OrderProviderRegistry.findByMarketplaceCode: é o que permite o webhook
  // de pagamento (WebhooksController, topic "payments") disparar a
  // reconciliação certa sem conhecer o provider.code interno. Case-
  // insensitive: o topic/channel chega como o marketplace enviou.
  findByMarketplaceCode(marketplaceCode: string): PaymentReconciliationCapableProvider[] {
    const normalized = marketplaceCode.toUpperCase();
    return this.providers.filter((p) => p.marketplaceCode === normalized);
  }
}
