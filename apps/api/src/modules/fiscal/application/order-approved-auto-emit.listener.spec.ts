import { OrderApprovedAutoEmitListener } from './order-approved-auto-emit.listener';
import { FiscalSettingsRepository, FiscalSettingsRecord } from './ports/fiscal-settings-repository.port';
import { AlertService } from '../../../shared/observability/ports/alert-service.port';
import { OrderPaidEvent } from '../../orders/domain/order-events';

function buildSettingsRecord(overrides: Partial<FiscalSettingsRecord> = {}): FiscalSettingsRecord {
  return {
    tenantId: 'tenant-1',
    cnpj: '12345678000199',
    razaoSocial: 'Empresa X',
    nomeFantasia: null,
    inscricaoEstadual: '123',
    regimeTributario: 1,
    logradouro: 'Rua A',
    numero: '100',
    bairro: 'Centro',
    municipio: 'SP',
    uf: 'SP',
    cep: '01000000',
    telefone: null,
    focusNfeTokenEnc: 'enc',
    environment: 'HOMOLOGACAO',
    autoEmitOnApproval: false,
    nfeSerie: null,
    defaultNaturezaOperacaoId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildEvent(overrides: Partial<OrderPaidEvent> = {}): OrderPaidEvent {
  return {
    tenantId: 'tenant-1',
    orderId: 'order-1',
    channelCode: 'MERCADO_LIVRE',
    externalOrderId: 'ext-1',
    totalAmount: 100,
    netAmount: 90,
    paidAt: new Date(),
    ...overrides,
  };
}

describe('OrderApprovedAutoEmitListener', () => {
  function buildListener() {
    const settings: jest.Mocked<FiscalSettingsRepository> = {
      findByTenant: jest.fn(),
      upsert: jest.fn(),
    };
    const alerts: jest.Mocked<AlertService> = {
      emitAlert: jest.fn(),
    };
    const listener = new OrderApprovedAutoEmitListener(settings, alerts);
    return { listener, settings, alerts };
  }

  it('sem configuração fiscal para o tenant: não emite alerta', async () => {
    const { listener, settings, alerts } = buildListener();
    settings.findByTenant.mockResolvedValue(null);

    await listener.handle(buildEvent());

    expect(alerts.emitAlert).not.toHaveBeenCalled();
  });

  it('autoEmitOnApproval desativado: não emite alerta', async () => {
    const { listener, settings, alerts } = buildListener();
    settings.findByTenant.mockResolvedValue(buildSettingsRecord({ autoEmitOnApproval: false }));

    await listener.handle(buildEvent());

    expect(alerts.emitAlert).not.toHaveBeenCalled();
  });

  it('autoEmitOnApproval ativado: emite alerta WARNING direcionando para emissão manual', async () => {
    const { listener, settings, alerts } = buildListener();
    settings.findByTenant.mockResolvedValue(buildSettingsRecord({ autoEmitOnApproval: true }));

    await listener.handle(buildEvent({ orderId: 'order-9', externalOrderId: 'ext-9' }));

    expect(alerts.emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'OrderApprovedAutoEmitListener',
        severity: 'WARNING',
        context: expect.objectContaining({ tenantId: 'tenant-1', orderId: 'order-9' }),
      }),
    );
    const [alert] = alerts.emitAlert.mock.calls[0];
    expect(alert.message).toContain('ext-9');
  });
});
