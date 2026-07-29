import { BadRequestException } from '@nestjs/common';
import { FiscalMarketplaceIntermediaryService } from './fiscal-marketplace-intermediary.service';
import { FiscalMarketplaceIntermediaryRepository } from './ports/fiscal-marketplace-intermediary-repository.port';

describe('FiscalMarketplaceIntermediaryService (Grupo G da NF-e, benchmark Bling)', () => {
  function buildService() {
    const repository: jest.Mocked<FiscalMarketplaceIntermediaryRepository> = {
      findByTenantAndChannel: jest.fn(),
      findAllByTenant: jest.fn(),
      upsert: jest.fn(),
      remove: jest.fn(),
    };
    const service = new FiscalMarketplaceIntermediaryService(repository);
    return { service, repository };
  }

  describe('upsert', () => {
    it('rejeita channelCode vazio', async () => {
      const { service } = buildService();
      await expect(service.upsert('tenant-1', { channelCode: '  ', cnpj: '03007331000141', idCadIntTran: 'x' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejeita CNPJ com menos de 14 dígitos', async () => {
      const { service } = buildService();
      await expect(service.upsert('tenant-1', { channelCode: 'MERCADO_LIVRE', cnpj: '123', idCadIntTran: 'x' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejeita idCadIntTran vazio', async () => {
      const { service } = buildService();
      await expect(
        service.upsert('tenant-1', { channelCode: 'MERCADO_LIVRE', cnpj: '03007331000141', idCadIntTran: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('normaliza channelCode para maiúsculas e cnpj para só dígitos', async () => {
      const { service, repository } = buildService();
      repository.upsert.mockResolvedValue({
        id: 'int-1',
        tenantId: 'tenant-1',
        channelCode: 'MERCADO_LIVRE',
        cnpj: '03007331000141',
        idCadIntTran: 'meu-nickname',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.upsert('tenant-1', { channelCode: 'mercado_livre', cnpj: '03.007.331/0001-41', idCadIntTran: 'meu-nickname' });

      expect(repository.upsert).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        channelCode: 'MERCADO_LIVRE',
        cnpj: '03007331000141',
        idCadIntTran: 'meu-nickname',
      });
    });
  });

  describe('findForChannel', () => {
    it('devolve null quando não há config (canal sem intermediador ou ainda não configurado) — nunca lança', async () => {
      const { service, repository } = buildService();
      repository.findByTenantAndChannel.mockResolvedValue(null);

      await expect(service.findForChannel('tenant-1', 'NUVEMSHOP')).resolves.toBeNull();
    });

    it('normaliza o channelCode para maiúsculas antes de consultar', async () => {
      const { service, repository } = buildService();
      repository.findByTenantAndChannel.mockResolvedValue(null);

      await service.findForChannel('tenant-1', 'mercado_livre');

      expect(repository.findByTenantAndChannel).toHaveBeenCalledWith('tenant-1', 'MERCADO_LIVRE');
    });
  });

  describe('remove', () => {
    it('normaliza o channelCode para maiúsculas antes de remover', async () => {
      const { service, repository } = buildService();

      await service.remove('tenant-1', 'shopee');

      expect(repository.remove).toHaveBeenCalledWith('tenant-1', 'SHOPEE');
    });
  });
});
