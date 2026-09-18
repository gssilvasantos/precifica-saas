import { MercadoLivreMonitoringAutoRegistrationService } from './mercado-livre-monitoring-auto-registration.service';
import { MonitoredListing, MonitoredListingRepository } from './ports/monitored-listing-repository.port';

function buildExisting(overrides: Partial<MonitoredListing> = {}): MonitoredListing {
  return {
    id: 'ml-1',
    tenantId: 'tenant-1',
    skuCode: 'SKU-1',
    competitorLabel: 'Sincronizado automaticamente — SKU SKU-1',
    targetRef: 'MLB111',
    radarCode: 'MERCADO_LIVRE_CATALOG_V1',
    channelCode: 'MERCADO_LIVRE',
    isActive: true,
    ...overrides,
  };
}

describe('MercadoLivreMonitoringAutoRegistrationService', () => {
  function buildService() {
    const repository = {
      create: jest.fn(),
      findAllActive: jest.fn(),
      findAllActiveByTenant: jest.fn(),
      setActive: jest.fn(),
    } as unknown as jest.Mocked<MonitoredListingRepository>;

    const service = new MercadoLivreMonitoringAutoRegistrationService(repository);
    return { service, repository };
  }

  it('lista vazia: não consulta o repositório, devolve created 0', async () => {
    const { service, repository } = buildService();

    const result = await service.reconcile('tenant-1', []);

    expect(result).toEqual({ created: 0 });
    expect(repository.findAllActiveByTenant).not.toHaveBeenCalled();
  });

  it('anúncio novo (sem MonitoredCompetitorListing correspondente): cria um registro com radarCode/channelCode do Mercado Livre', async () => {
    const { service, repository } = buildService();
    repository.findAllActiveByTenant.mockResolvedValue([]);

    const result = await service.reconcile('tenant-1', [{ skuCode: 'SKU-1', externalId: 'MLB111' }]);

    expect(result).toEqual({ created: 1 });
    expect(repository.create).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      skuCode: 'SKU-1',
      competitorLabel: expect.stringContaining('SKU-1'),
      targetRef: 'MLB111',
      radarCode: 'MERCADO_LIVRE_CATALOG_V1',
      channelCode: 'MERCADO_LIVRE',
    });
  });

  it('anúncio já monitorado (mesmo targetRef, mesmo canal): não cria de novo', async () => {
    const { service, repository } = buildService();
    repository.findAllActiveByTenant.mockResolvedValue([buildExisting({ targetRef: 'MLB111' })]);

    const result = await service.reconcile('tenant-1', [{ skuCode: 'SKU-1', externalId: 'MLB111' }]);

    expect(result).toEqual({ created: 0 });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('monitoramento existente de OUTRO canal com o mesmo targetRef: não conta como já cadastrado (ignora canais diferentes)', async () => {
    const { service, repository } = buildService();
    repository.findAllActiveByTenant.mockResolvedValue([buildExisting({ targetRef: 'MLB111', channelCode: 'MANUAL' })]);

    const result = await service.reconcile('tenant-1', [{ skuCode: 'SKU-1', externalId: 'MLB111' }]);

    expect(result).toEqual({ created: 1 });
  });

  it('lote misto (um já existente, um novo): cria só o que falta', async () => {
    const { service, repository } = buildService();
    repository.findAllActiveByTenant.mockResolvedValue([buildExisting({ targetRef: 'MLB111' })]);

    const result = await service.reconcile('tenant-1', [
      { skuCode: 'SKU-1', externalId: 'MLB111' },
      { skuCode: 'SKU-2', externalId: 'MLB222' },
    ]);

    expect(result).toEqual({ created: 1 });
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ targetRef: 'MLB222' }));
  });

  it('create de um item falha: loga e segue para os demais, sem lançar', async () => {
    const { service, repository } = buildService();
    repository.findAllActiveByTenant.mockResolvedValue([]);
    repository.create.mockRejectedValueOnce(new Error('violação de unicidade')).mockResolvedValueOnce(buildExisting());

    const result = await service.reconcile('tenant-1', [
      { skuCode: 'SKU-1', externalId: 'MLB111' },
      { skuCode: 'SKU-2', externalId: 'MLB222' },
    ]);

    expect(result).toEqual({ created: 1 });
    expect(repository.create).toHaveBeenCalledTimes(2);
  });
});
