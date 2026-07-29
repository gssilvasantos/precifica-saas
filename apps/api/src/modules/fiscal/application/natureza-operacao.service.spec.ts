import { NaturezaOperacaoService } from './natureza-operacao.service';
import { NaturezaOperacaoRecord, NaturezaOperacaoRepository } from './ports/natureza-operacao-repository.port';

function buildRecord(overrides: Partial<NaturezaOperacaoRecord> = {}): NaturezaOperacaoRecord {
  return {
    id: 'natureza-1',
    tenantId: 'tenant-1',
    nome: 'Venda de mercadoria - Simples Nacional (padrão)',
    cfopVendaInterno: '5102',
    cfopVendaInterestadual: '6102',
    cfopDevolucaoInterno: null,
    cfopDevolucaoInterestadual: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('NaturezaOperacaoService', () => {
  function buildService() {
    const repository: jest.Mocked<NaturezaOperacaoRepository> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      findAllByTenant: jest.fn(),
      update: jest.fn(),
    };
    const service = new NaturezaOperacaoService(repository);
    return { service, repository };
  }

  const validInput = {
    nome: 'Venda de mercadoria - Simples Nacional (padrão)',
    cfopVendaInterno: '5102',
    cfopVendaInterestadual: '6102',
  };

  describe('create', () => {
    it('cria com sucesso quando os CFOPs têm 4 dígitos e o nome é único', async () => {
      const { service, repository } = buildService();
      repository.findByName.mockResolvedValue(null);
      repository.create.mockImplementation(async (data) => buildRecord(data));

      const result = await service.create('tenant-1', validInput);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', nome: validInput.nome, isActive: true }),
      );
      expect(result.cfopVendaInterno).toBe('5102');
    });

    it('rejeita nome vazio', async () => {
      const { service, repository } = buildService();
      await expect(service.create('tenant-1', { ...validInput, nome: '  ' })).rejects.toThrow();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejeita CFOP de venda com formato inválido', async () => {
      const { service, repository } = buildService();
      await expect(service.create('tenant-1', { ...validInput, cfopVendaInterno: '51' })).rejects.toThrow();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejeita CFOP de devolução customizado com formato inválido', async () => {
      const { service, repository } = buildService();
      await expect(
        service.create('tenant-1', { ...validInput, cfopDevolucaoInterno: 'XXXX' }),
      ).rejects.toThrow();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejeita nome duplicado no mesmo tenant', async () => {
      const { service, repository } = buildService();
      repository.findByName.mockResolvedValue(buildRecord());

      await expect(service.create('tenant-1', validInput)).rejects.toThrow(/Já existe/);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('lança NotFoundException quando não encontra', async () => {
      const { service, repository } = buildService();
      repository.findById.mockResolvedValue(null);
      await expect(service.findOne('tenant-1', 'x')).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('atualiza os CFOPs mantendo o nome quando não informado', async () => {
      const { service, repository } = buildService();
      repository.findById.mockResolvedValue(buildRecord());
      repository.update.mockImplementation(async (id, data) => buildRecord({ id, ...data }));

      const result = await service.update('tenant-1', 'natureza-1', { cfopVendaInterno: '5405' });

      expect(repository.update).toHaveBeenCalledWith('natureza-1', expect.objectContaining({ nome: buildRecord().nome, cfopVendaInterno: '5405' }));
      expect(result.cfopVendaInterno).toBe('5405');
    });

    it('rejeita renomear para um nome já usado por outra natureza', async () => {
      const { service, repository } = buildService();
      repository.findById.mockResolvedValue(buildRecord());
      repository.findByName.mockResolvedValue(buildRecord({ id: 'outra-natureza' }));

      await expect(service.update('tenant-1', 'natureza-1', { nome: 'Outro nome' })).rejects.toThrow(/Já existe/);
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('setActive', () => {
    it('desativa uma natureza existente', async () => {
      const { service, repository } = buildService();
      repository.findById.mockResolvedValue(buildRecord());
      repository.update.mockResolvedValue(buildRecord({ isActive: false }));

      const result = await service.setActive('tenant-1', 'natureza-1', false);

      expect(repository.update).toHaveBeenCalledWith('natureza-1', { isActive: false });
      expect(result.isActive).toBe(false);
    });
  });

  describe('requireActiveForEmission', () => {
    it('rejeita quando a natureza está inativa', async () => {
      const { service, repository } = buildService();
      repository.findById.mockResolvedValue(buildRecord({ isActive: false }));

      await expect(service.requireActiveForEmission('tenant-1', 'natureza-1')).rejects.toThrow(/inativa/);
    });

    it('devolve a natureza quando está ativa', async () => {
      const { service, repository } = buildService();
      repository.findById.mockResolvedValue(buildRecord());

      const result = await service.requireActiveForEmission('tenant-1', 'natureza-1');
      expect(result.id).toBe('natureza-1');
    });
  });
});
