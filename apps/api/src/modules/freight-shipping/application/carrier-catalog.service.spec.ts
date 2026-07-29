import { CarrierCatalogService } from './carrier-catalog.service';
import { CarrierRecord, CarrierRepository } from './ports/carrier-repository.port';
import { CarrierServiceRecord, CarrierServiceRepository } from './ports/carrier-service-repository.port';

function buildCarrier(overrides: Partial<CarrierRecord> = {}): CarrierRecord {
  return {
    id: 'carrier-1',
    tenantId: 'tenant-1',
    name: 'Jadlog',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildServiceRecord(overrides: Partial<CarrierServiceRecord> = {}): CarrierServiceRecord {
  return {
    id: 'service-1',
    tenantId: 'tenant-1',
    carrierId: 'carrier-1',
    name: 'Package',
    aliases: [],
    estimativaEntregaDias: 5,
    automationCode: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('CarrierCatalogService', () => {
  function buildCatalog() {
    const carriers: jest.Mocked<CarrierRepository> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      findAllByTenant: jest.fn(),
      update: jest.fn(),
    };
    const services: jest.Mocked<CarrierServiceRepository> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByNameForCarrier: jest.fn(),
      findAllByCarrier: jest.fn(),
      findAllByTenant: jest.fn(),
      update: jest.fn(),
    };
    const catalog = new CarrierCatalogService(carriers, services);
    return { catalog, carriers, services };
  }

  describe('createCarrier', () => {
    it('cria com sucesso quando o nome é único', async () => {
      const { catalog, carriers } = buildCatalog();
      carriers.findByName.mockResolvedValue(null);
      carriers.create.mockImplementation(async (data) => buildCarrier(data));

      const result = await catalog.createCarrier('tenant-1', { name: 'Jadlog' });

      expect(carriers.create).toHaveBeenCalledWith({ tenantId: 'tenant-1', name: 'Jadlog', isActive: true });
      expect(result.name).toBe('Jadlog');
    });

    it('rejeita nome vazio', async () => {
      const { catalog, carriers } = buildCatalog();
      await expect(catalog.createCarrier('tenant-1', { name: '  ' })).rejects.toThrow();
      expect(carriers.create).not.toHaveBeenCalled();
    });

    it('rejeita nome duplicado no mesmo tenant', async () => {
      const { catalog, carriers } = buildCatalog();
      carriers.findByName.mockResolvedValue(buildCarrier());
      await expect(catalog.createCarrier('tenant-1', { name: 'Jadlog' })).rejects.toThrow(/Já existe/);
      expect(carriers.create).not.toHaveBeenCalled();
    });
  });

  describe('findCarrier', () => {
    it('lança NotFoundException quando não encontra', async () => {
      const { catalog, carriers } = buildCatalog();
      carriers.findById.mockResolvedValue(null);
      await expect(catalog.findCarrier('tenant-1', 'x')).rejects.toThrow();
    });
  });

  describe('createService', () => {
    it('cria com sucesso quando o transportador existe e o nome é único', async () => {
      const { catalog, carriers, services } = buildCatalog();
      carriers.findById.mockResolvedValue(buildCarrier());
      services.findByNameForCarrier.mockResolvedValue(null);
      services.create.mockImplementation(async (data) => buildServiceRecord(data));

      const result = await catalog.createService('tenant-1', 'carrier-1', { name: 'Package' });

      expect(services.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', carrierId: 'carrier-1', name: 'Package', aliases: [], isActive: true }),
      );
      expect(result.name).toBe('Package');
    });

    it('rejeita se o transportador não existe', async () => {
      const { catalog, carriers, services } = buildCatalog();
      carriers.findById.mockResolvedValue(null);
      await expect(catalog.createService('tenant-1', 'carrier-x', { name: 'Package' })).rejects.toThrow();
      expect(services.create).not.toHaveBeenCalled();
    });

    it('rejeita automationCode que não corresponde a nenhuma forma de envio conhecida', async () => {
      const { catalog, carriers, services } = buildCatalog();
      carriers.findById.mockResolvedValue(buildCarrier());
      await expect(
        catalog.createService('tenant-1', 'carrier-1', { name: 'Package', automationCode: 'CODIGO_INVENTADO' }),
      ).rejects.toThrow(/automationCode/);
      expect(services.create).not.toHaveBeenCalled();
    });

    it('aceita automationCode conhecido (case-insensitive)', async () => {
      const { catalog, carriers, services } = buildCatalog();
      carriers.findById.mockResolvedValue(buildCarrier());
      services.findByNameForCarrier.mockResolvedValue(null);
      services.create.mockImplementation(async (data) => buildServiceRecord(data));

      const result = await catalog.createService('tenant-1', 'carrier-1', { name: 'Package', automationCode: 'correios' });
      expect(result.automationCode).toBe('correios');
    });

    it('rejeita nome de serviço duplicado no mesmo transportador', async () => {
      const { catalog, carriers, services } = buildCatalog();
      carriers.findById.mockResolvedValue(buildCarrier());
      services.findByNameForCarrier.mockResolvedValue(buildServiceRecord());

      await expect(catalog.createService('tenant-1', 'carrier-1', { name: 'Package' })).rejects.toThrow(/Já existe/);
      expect(services.create).not.toHaveBeenCalled();
    });
  });

  describe('updateService', () => {
    it('mantém automationCode atual quando não informado', async () => {
      const { catalog, services } = buildCatalog();
      services.findById.mockResolvedValue(buildServiceRecord({ automationCode: 'CORREIOS' }));
      services.update.mockImplementation(async (id, data) => buildServiceRecord({ id, ...data }));

      const result = await catalog.updateService('tenant-1', 'service-1', { estimativaEntregaDias: 3 });

      expect(services.update).toHaveBeenCalledWith(
        'service-1',
        expect.objectContaining({ automationCode: 'CORREIOS', estimativaEntregaDias: 3 }),
      );
      expect(result.automationCode).toBe('CORREIOS');
    });

    it('permite limpar automationCode explicitamente com string vazia', async () => {
      const { catalog, services } = buildCatalog();
      services.findById.mockResolvedValue(buildServiceRecord({ automationCode: 'CORREIOS' }));
      services.update.mockImplementation(async (id, data) => buildServiceRecord({ id, ...data }));

      const result = await catalog.updateService('tenant-1', 'service-1', { automationCode: '' });
      expect(result.automationCode).toBeNull();
    });
  });

  describe('matchByFormaEnvio', () => {
    it('retorna o match enriquecido com nome do transportador e estimativa', async () => {
      const { catalog, carriers, services } = buildCatalog();
      services.findAllByTenant.mockResolvedValue([buildServiceRecord({ name: 'Package', estimativaEntregaDias: 7 })]);
      carriers.findById.mockResolvedValue(buildCarrier({ name: 'Jadlog' }));

      const result = await catalog.matchByFormaEnvio('tenant-1', 'PACKAGE');

      expect(result).toEqual(
        expect.objectContaining({
          carrierServiceId: 'service-1',
          carrierId: 'carrier-1',
          carrierName: 'Jadlog',
          serviceName: 'Package',
          estimativaEntregaDias: 7,
        }),
      );
    });

    it('retorna null sem lançar quando nada bate', async () => {
      const { catalog, services } = buildCatalog();
      services.findAllByTenant.mockResolvedValue([buildServiceRecord({ name: 'Package' })]);

      const result = await catalog.matchByFormaEnvio('tenant-1', 'TRANSPORTADORA_DESCONHECIDA');
      expect(result).toBeNull();
    });
  });

  describe('resolveFormaEnvioForCarrierService', () => {
    it('resolve a string normalizada a partir do serviço ativo', async () => {
      const { catalog, services } = buildCatalog();
      services.findById.mockResolvedValue(buildServiceRecord({ name: 'Package Express' }));

      const result = await catalog.resolveFormaEnvioForCarrierService('tenant-1', 'service-1');
      expect(result).toBe('PACKAGE_EXPRESS');
    });

    it('rejeita serviço inativo', async () => {
      const { catalog, services } = buildCatalog();
      services.findById.mockResolvedValue(buildServiceRecord({ isActive: false }));

      await expect(catalog.resolveFormaEnvioForCarrierService('tenant-1', 'service-1')).rejects.toThrow(/inativo/);
    });
  });
});
