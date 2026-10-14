import { Injectable, Logger } from '@nestjs/common';
import {
  FetchContext,
  PaymentReconciliationCapableProvider,
  ProviderCapability,
  ProviderHealthStatus,
} from '../../../../../shared/contracts/marketplace-provider.contract';
import { RawSettlementEntry } from '../../../../../shared/contracts/settlement-report-parser.contract';
import { MercadoLivreApiClient } from './mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../application/mercado-livre-connection.service';

// Terceira capacidade "de leitura financeira" do Mercado Livre no hub de
// conciliação (13/10/2026, a pedido do Gui — "módulo de conciliação por
// canal"), classe separada de MercadoLivreOrderProvider/MercadoLivreAdsProvider
// (mesmo racional: uma capacidade por classe, mesmo canal). Registrada em
// PAYMENT_RECONCILIATION_PROVIDERS (módulo Financial Intelligence) — exportada
// por MarketplaceIntelligenceModule, mesmo padrão de MercadoLivreOrderProvider
// ser exportado para o módulo Orders.
//
// Reaproveita a MESMA conexão OAuth2 (MercadoLivreConnectionService) — nenhuma
// reautorização do vendedor é necessária, desde que o escopo de leitura
// financeira esteja habilitado (ver AVISO DE HONESTIDADE em
// MercadoLivreApiClient.fetchSettledPayments sobre a separação de escopos
// ML/Mercado Pago a partir de agosto/2026).
@Injectable()
export class MercadoLivreChannelPaymentProvider implements PaymentReconciliationCapableProvider {
  readonly code = 'MERCADO_LIVRE_PAYMENTS';
  readonly marketplaceCode = 'MERCADO_LIVRE';
  readonly sourceType = 'OFFICIAL_API' as const;
  readonly capabilities = [ProviderCapability.PAYMENT_RECONCILIATION];

  private readonly logger = new Logger(MercadoLivreChannelPaymentProvider.name);

  constructor(
    private readonly client: MercadoLivreApiClient,
    private readonly connection: MercadoLivreConnectionService,
  ) {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'UP' }; // saúde real é por tenant — mesmo padrão de MercadoLivreOrderProvider
  }

  async listTenantIdsToSync(): Promise<string[]> {
    return this.connection.listActiveTenantIds();
  }

  async fetchSettledPayments(ctx: FetchContext): Promise<RawSettlementEntry[]> {
    if (!ctx.tenantId) {
      this.logger.warn('MercadoLivreChannelPaymentProvider chamado sem tenantId — pagamento é sempre por vendedor, não há candidato global.');
      return [];
    }
    if (!ctx.since) {
      this.logger.warn(`Tenant ${ctx.tenantId}: fetchSettledPayments chamado sem janela (since) — pulando para não buscar o histórico inteiro.`);
      return [];
    }

    // getValidAccessToken já faz o refresh automático se necessário — este
    // provider nunca decide isso sozinho (mesmo padrão de MercadoLivreOrderProvider).
    const accessToken = await this.connection.getValidAccessToken(ctx.tenantId);
    const sellerId = await this.connection.getSellerId(ctx.tenantId);
    if (!sellerId) {
      this.logger.warn(`Tenant ${ctx.tenantId}: conexão Mercado Livre sem sellerId resolvido — pulando conciliação de pagamento.`);
      return [];
    }

    const payments = await this.client.fetchSettledPayments(sellerId, accessToken, ctx.since);
    this.logger.log(`Conciliação ML tenant=${ctx.tenantId}: ${payments.length} pagamento(s) liquidado(s) encontrado(s) desde ${ctx.since.toISOString()}.`);

    // MlSettledPayment e RawSettlementEntry têm o MESMO shape hoje
    // (externalReference/amount/settledAt) — mapeamento explícito campo a
    // campo, não um cast, para que uma divergência futura entre os dois
    // contratos quebre em tempo de compilação aqui, não silenciosamente.
    return payments.map((p) => ({ externalReference: p.externalReference, amount: p.amount, settledAt: p.settledAt }));
  }
}
