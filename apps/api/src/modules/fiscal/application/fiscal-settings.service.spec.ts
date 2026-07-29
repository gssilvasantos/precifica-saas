import { FiscalSettingsService } from './fiscal-settings.service';
import { FiscalSettingsRepository, FiscalSettingsRecord } from './ports/fiscal-settings-repository.port';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { NaturezaOperacaoService } from './natureza-operacao.service';

function buildRecord(overrides: Partial<FiscalSettingsRecord> = {}): FiscalSettingsRecord {
  return {
    tenantId: 'tenant-1',
    cnpj: '12345678000199',
    razaoSocial: 'Empresa X LTDA',
    nomeFantasia: null,
    inscricaoEstadual: '123456789',
    regimeTributario: 1,
    logradouro: 'Rua A',
    numero: '100',
    bairro: 'Centro',
    municipio: 'São Paulo',
    uf: 'SP',
    cep: '01000000',
    telefone: null,
    focusNfeTokenEnc: 'iv.tag.cipher',
    environment: 'HOMOLOGACAO',
    autoEmitOnApproval: false,
    nfeSerie: null,
    defaultNaturezaOperacaoId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('FiscalSettingsService', () => {
  function buildService() {
    const settings: jest.Mocked<FiscalSettingsRepository> = {
      findByTenant: jest.fn(),
      upsert: jest.fn(),
    };
    const credentials = {
      encrypt: jest.fn((plain: string) => `enc(${plain})`),
      decrypt: jest.fn((cipher: string) => cipher.replace(/^enc\(/, '').replace(/\)$/, '')),
    } as unknown as jest.Mocked<CredentialEncryptionService>;
    const naturezasOperacao = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<NaturezaOperacaoService>;

    const service = new FiscalSettingsService(settings, credentials, naturezasOperacao);
    return { service, settings, credentials, naturezasOperacao };
  }

  describe('get', () => {
    it('devolve as configurações sem o token', async () => {
      const { service, settings } = buildService();
      settings.findByTenant.mockResolvedValue(buildRecord());

      const result = await service.get('tenant-1');

      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('focusNfeTokenEnc');
      expect(result?.cnpj).toBe('12345678000199');
    });

    it('devolve null quando o tenant não tem configuração', async () => {
      const { service, settings } = buildService();
      settings.findByTenant.mockResolvedValue(null);

      const result = await service.get('tenant-1');

      expect(result).toBeNull();
    });
  });

  describe('upsert', () => {
    const validInput = {
      cnpj: '12.345.678/0001-99',
      razaoSocial: 'Empresa X LTDA',
      inscricaoEstadual: '123456789',
      logradouro: 'Rua A',
      numero: '100',
      bairro: 'Centro',
      municipio: 'São Paulo',
      uf: 'sp',
      cep: '01000-000',
      focusNfeToken: 'meu-token-secreto',
    };

    it('cria a primeira configuração, criptografando o token', async () => {
      const { service, settings, credentials } = buildService();
      settings.findByTenant.mockResolvedValue(null);
      settings.upsert.mockImplementation(async (data) => buildRecord(data));

      const result = await service.upsert('tenant-1', validInput);

      expect(credentials.encrypt).toHaveBeenCalledWith('meu-token-secreto');
      expect(settings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          cnpj: '12345678000199', // dígitos só
          cep: '01000000',
          uf: 'SP',
          focusNfeTokenEnc: 'enc(meu-token-secreto)',
          environment: 'HOMOLOGACAO',
          autoEmitOnApproval: false,
        }),
      );
      expect(result).not.toHaveProperty('focusNfeTokenEnc');
    });

    it('primeira configuração sem token: rejeita', async () => {
      const { service, settings } = buildService();
      settings.findByTenant.mockResolvedValue(null);

      const { focusNfeToken: _omit, ...withoutToken } = validInput;
      await expect(service.upsert('tenant-1', withoutToken)).rejects.toThrow();
      expect(settings.upsert).not.toHaveBeenCalled();
    });

    it('atualização parcial sem novo token: reaproveita o token já criptografado', async () => {
      const { service, settings, credentials } = buildService();
      settings.findByTenant.mockResolvedValue(buildRecord({ focusNfeTokenEnc: 'ja-existente' }));
      settings.upsert.mockImplementation(async (data) => buildRecord(data));

      const { focusNfeToken: _omit, ...withoutToken } = validInput;
      await service.upsert('tenant-1', withoutToken);

      expect(credentials.encrypt).not.toHaveBeenCalled();
      expect(settings.upsert).toHaveBeenCalledWith(expect.objectContaining({ focusNfeTokenEnc: 'ja-existente' }));
    });

    it('rejeita campo obrigatório ausente', async () => {
      const { service, settings } = buildService();
      settings.findByTenant.mockResolvedValue(null);

      await expect(service.upsert('tenant-1', { ...validInput, cnpj: '' })).rejects.toThrow();
      expect(settings.upsert).not.toHaveBeenCalled();
    });

    it('defaultNaturezaOperacaoId informado: valida que a natureza existe/pertence ao tenant antes de gravar', async () => {
      const { service, settings, naturezasOperacao } = buildService();
      settings.findByTenant.mockResolvedValue(null);
      settings.upsert.mockImplementation(async (data) => buildRecord(data));
      naturezasOperacao.findOne.mockResolvedValue({
        id: 'natureza-1',
        tenantId: 'tenant-1',
        nome: 'Venda padrão',
        cfopVendaInterno: '5102',
        cfopVendaInterestadual: '6102',
        cfopDevolucaoInterno: null,
        cfopDevolucaoInterestadual: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.upsert('tenant-1', { ...validInput, defaultNaturezaOperacaoId: 'natureza-1' });

      expect(naturezasOperacao.findOne).toHaveBeenCalledWith('tenant-1', 'natureza-1');
      expect(settings.upsert).toHaveBeenCalledWith(expect.objectContaining({ defaultNaturezaOperacaoId: 'natureza-1' }));
    });

    it('defaultNaturezaOperacaoId: null explícito remove a natureza padrão já salva', async () => {
      const { service, settings, naturezasOperacao } = buildService();
      settings.findByTenant.mockResolvedValue(buildRecord({ defaultNaturezaOperacaoId: 'natureza-antiga' }));
      settings.upsert.mockImplementation(async (data) => buildRecord(data));

      await service.upsert('tenant-1', { ...validInput, defaultNaturezaOperacaoId: null });

      expect(naturezasOperacao.findOne).not.toHaveBeenCalled();
      expect(settings.upsert).toHaveBeenCalledWith(expect.objectContaining({ defaultNaturezaOperacaoId: null }));
    });

    it('defaultNaturezaOperacaoId ausente (undefined): mantém o valor já salvo', async () => {
      const { service, settings, naturezasOperacao } = buildService();
      settings.findByTenant.mockResolvedValue(buildRecord({ defaultNaturezaOperacaoId: 'natureza-existente' }));
      settings.upsert.mockImplementation(async (data) => buildRecord(data));

      await service.upsert('tenant-1', validInput);

      expect(naturezasOperacao.findOne).not.toHaveBeenCalled();
      expect(settings.upsert).toHaveBeenCalledWith(expect.objectContaining({ defaultNaturezaOperacaoId: 'natureza-existente' }));
    });
  });

  describe('requireForEmission', () => {
    it('devolve o registro completo e o token decriptado', async () => {
      const { service, settings, credentials } = buildService();
      settings.findByTenant.mockResolvedValue(buildRecord({ focusNfeTokenEnc: 'enc(token-real)' }));

      const result = await service.requireForEmission('tenant-1');

      expect(credentials.decrypt).toHaveBeenCalledWith('enc(token-real)');
      expect(result.token).toBe('token-real');
      expect(result.record.cnpj).toBe('12345678000199');
    });

    it('rejeita quando o tenant não configurou nada ainda', async () => {
      const { service, settings } = buildService();
      settings.findByTenant.mockResolvedValue(null);

      await expect(service.requireForEmission('tenant-1')).rejects.toThrow();
    });
  });
});
