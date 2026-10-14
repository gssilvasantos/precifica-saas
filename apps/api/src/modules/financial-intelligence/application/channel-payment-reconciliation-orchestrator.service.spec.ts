import { ChannelPaymentReconciliationOrchestrator } from './channel-payment-reconciliation-orchestrator.service';
import { PaymentReconciliationProviderRegistry } from './payment-reconciliation-provider-registry.service';
import { ReceivableReconciliationService } from './receivable-reconciliation.service';
import { AlertService } from '../../../shared/observability/ports/alert-service.port';
import { PaymentReconciliationCapableProvider } from '../../../shared/contracts/marketplace-provider.contract';

function buildProvider(overrides: Partial<PaymentReconciliationCapableProvider> = {}): PaymentReconciliationCapableProvider {
  return {
    code: 'MERCADO_LIVRE_PAYMENTS',
    marketplaceCode: 'MERCADO_LIVRE',
    sourceType: 'OFFICIAL_API',
    capabilities: [],
    healthCheck: jest.fn(),
    listTenantIdsToSync: jest.fn().mockResolvedValue(['tenant-1']),
    fetchSettledPayments: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('ChannelPaymentReconciliationOrchestrator', () => {
  function buildOrchestrator(providers: PaymentReconciliationCapableProvider[]) {
    const registry = { findByMarketplaceCode: jest.fn().mockReturnValue(providers) } as unknown as jest.Mocked<PaymentReconciliationProviderRegistry>;
    const reconciliation = {
      reconcileEntries: jest.fn().mockResolvedValue({ matched: 0, alreadyReconciled: 0, unmatchedReferences: [] }),
    } as unknown as jest.Mocked<ReceivableReconciliationService>;
    const alerts: jest.Mocked<AlertService> = { emitAlert: jest.fn() };
    const orchestrator = new ChannelPaymentReconciliationOrchestrator(registry, reconciliation, alerts);
    return { orchestrator, registry, reconciliation, alerts };
  }

  it('canal sem provider registrado: loga aviso e não chama reconciliação', async () => {
    const { orchestrator, reconciliation } = buildOrchestrator([]);

    await orchestrator.syncChannel('MERCADO_LIVRE');

    expect(reconciliation.reconcileEntries).not.toHaveBeenCalled();
  });

  it('provider sem listTenantIdsToSync: pula o provider, não lança', async () => {
    const provider = buildProvider({ listTenantIdsToSync: undefined });
    const { orchestrator, reconciliation } = buildOrchestrator([provider]);

    await orchestrator.syncChannel('MERCADO_LIVRE');

    expect(reconciliation.reconcileEntries).not.toHaveBeenCalled();
  });

  it('busca pagamentos liquidados por tenant e chama reconcileEntries com as entries retornadas', async () => {
    const entries = [{ externalReference: 'ORDER-1', amount: 100, settledAt: new Date('2026-10-01') }];
    const provider = buildProvider({ fetchSettledPayments: jest.fn().mockResolvedValue(entries) });
    const { orchestrator, reconciliation } = buildOrchestrator([provider]);

    await orchestrator.syncChannel('MERCADO_LIVRE');

    expect(provider.fetchSettledPayments).toHaveBeenCalledWith(
      expect.objectContaining({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' }),
    );
    expect(reconciliation.reconcileEntries).toHaveBeenCalledWith('tenant-1', 'MERCADO_LIVRE', entries);
  });

  it('multi-tenant: processa cada tenant retornado por listTenantIdsToSync separadamente', async () => {
    const provider = buildProvider({ listTenantIdsToSync: jest.fn().mockResolvedValue(['tenant-1', 'tenant-2']) });
    const { orchestrator, reconciliation } = buildOrchestrator([provider]);

    await orchestrator.syncChannel('MERCADO_LIVRE');

    expect(reconciliation.reconcileEntries).toHaveBeenCalledTimes(2);
    expect(reconciliation.reconcileEntries).toHaveBeenCalledWith('tenant-1', 'MERCADO_LIVRE', []);
    expect(reconciliation.reconcileEntries).toHaveBeenCalledWith('tenant-2', 'MERCADO_LIVRE', []);
  });

  it('falha de um tenant não impede o processamento dos demais, e emite alerta', async () => {
    const provider = buildProvider({
      listTenantIdsToSync: jest.fn().mockResolvedValue(['tenant-1', 'tenant-2']),
      fetchSettledPayments: jest
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce([]),
    });
    const { orchestrator, reconciliation, alerts } = buildOrchestrator([provider]);

    await orchestrator.syncChannel('MERCADO_LIVRE');

    expect(reconciliation.reconcileEntries).toHaveBeenCalledTimes(1);
    expect(alerts.emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ChannelPaymentReconciliationOrchestrator', severity: 'ERROR' }),
    );
  });
});
