import { Inject, Injectable, Logger } from '@nestjs/common';
import { PaymentReconciliationProviderRegistry } from './payment-reconciliation-provider-registry.service';
import { ReceivableReconciliationService } from './receivable-reconciliation.service';
import { PaymentReconciliationCapableProvider } from '../../../shared/contracts/marketplace-provider.contract';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';
import { TenantContextStore } from '../../../shared/prisma/tenant-context';

// Janela de retrospecto da conciliação de pagamento. Maior, de propósito,
// que a janela incremental de pedidos (OrderSyncOrchestrator —
// INCREMENTAL_WINDOW_MS, 7 dias): a liberação do dinheiro no Mercado Livre
// pode atrasar além da aprovação do pagamento (parcelamento, retenção por
// reputação) — usar a mesma janela de pedidos arriscaria nunca conciliar um
// repasse liberado depois do prazo de pedidos.
//
// AVISO DE HONESTIDADE: 30 dias é uma estimativa conservadora, não validada
// contra um caso real de liberação tardia em produção (sem credencial real
// disponível para testar isto neste ambiente) — ajustar se um caso real
// mostrar que não é suficiente.
const SETTLEMENT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

// Pipeline análogo a OrderSyncOrchestrator/RuleSyncOrchestrator, mas para
// conciliação financeira: Fetch (pagamentos liquidados desde a janela, via
// PaymentReconciliationCapableProvider) -> Reconcile
// (ReceivableReconciliationService.reconcileEntries — MESMA lógica de match
// usada pelo caminho manual de upload de arquivo).
//
// Disparado hoje só pelo nudge do webhook (topic "payments", ver
// PaymentWebhookListener) — sem scheduler/cron próprio ainda. Simplificação
// consciente desta primeira fatia (13/10/2026): se o webhook do Mercado
// Livre falhar silenciosamente (entrega não garantida por nenhum provedor
// de webhook), nenhum repasse atrasado seria conciliado até o próximo
// webhook chegar. Risco aceito nesta fatia porque o ReceivableRecord já
// existe como PENDING desde a criação do pedido (ReceivableFromOrderListener)
// — o pior caso é o status ficar "pendente" por mais tempo que o real, nunca
// perder o registro. Mitigação futura: um scheduler próprio (mesmo padrão de
// OrdersSyncSchedulerJob) chamando syncChannel() periodicamente como
// fallback, não implementado nesta fatia.
@Injectable()
export class ChannelPaymentReconciliationOrchestrator {
  private readonly logger = new Logger(ChannelPaymentReconciliationOrchestrator.name);

  constructor(
    private readonly registry: PaymentReconciliationProviderRegistry,
    private readonly reconciliation: ReceivableReconciliationService,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  // Endereçado por CANAL (marketplaceCode) — mesmo racional de
  // WebhooksController: o webhook chega por canal, não por provider.code
  // interno.
  async syncChannel(marketplaceCode: string): Promise<void> {
    const providers = this.registry.findByMarketplaceCode(marketplaceCode);
    if (providers.length === 0) {
      this.logger.warn(`Nenhum PaymentReconciliationCapableProvider registrado para ${marketplaceCode} — nada a conciliar.`);
      return;
    }
    for (const provider of providers) {
      await this.syncProvider(provider);
    }
  }

  private async syncProvider(provider: PaymentReconciliationCapableProvider): Promise<void> {
    if (!provider.listTenantIdsToSync) {
      this.logger.warn(`Provider de conciliação ${provider.code} não implementa listTenantIdsToSync() — pulando.`);
      return;
    }

    // Bypass estreito só para descobrir quais tenants este provider atende —
    // cada tenant reabre seu próprio contexto antes de tocar dado de
    // pagamento/recebível (mesmo racional de RuleSyncOrchestrator/
    // OrderSyncOrchestrator — ver docs/row-level-security-architecture.md,
    // seção 3.3).
    const tenantIds = await TenantContextStore.runAsService(() => provider.listTenantIdsToSync!());
    const since = new Date(Date.now() - SETTLEMENT_LOOKBACK_MS);

    for (const tenantId of tenantIds) {
      await TenantContextStore.run(tenantId, () => this.syncTenant(provider, tenantId, since));
    }
  }

  private async syncTenant(provider: PaymentReconciliationCapableProvider, tenantId: string, since: Date): Promise<void> {
    try {
      const entries = await provider.fetchSettledPayments({ marketplaceCode: provider.marketplaceCode, tenantId, since });
      const result = await this.reconciliation.reconcileEntries(tenantId, provider.marketplaceCode, entries);
      this.logger.log(
        `Conciliação de pagamento ${provider.code} (tenant ${tenantId}): ${entries.length} pagamento(s) liquidado(s) encontrados, ` +
          `${result.matched} casados, ${result.alreadyReconciled} já reconciliados, ${result.unmatchedReferences.length} sem match.`,
      );
    } catch (error) {
      const message = `Conciliação de pagamento de ${provider.code} (tenant ${tenantId}) falhou: ${(error as Error).message}`;
      this.logger.error(message);
      // Falha de integração externa emite alerta (regra do projeto) — e não
      // interrompe os demais tenants deste provider, mesmo racional de
      // OrderSyncOrchestrator.syncTenant.
      this.alerts.emitAlert({
        source: 'ChannelPaymentReconciliationOrchestrator',
        severity: 'ERROR',
        message: `Conciliação de pagamento de ${provider.code} falhou`,
        context: { tenantId, providerCode: provider.code, error: (error as Error).message },
      });
    }
  }
}
