import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PromotionCampaignService } from './promotion-campaign.service';
import { PromotionCampaignRepository } from './ports/promotion-campaign-repository.port';
import { PromotionCampaign } from '../domain/promotion-campaign.entity';

function buildCampaign(overrides: Partial<PromotionCampaign> = {}): PromotionCampaign {
  return {
    id: 'campaign-1',
    tenantId: 'tenant-1',
    name: 'Black Friday',
    channelCode: 'NUVEMSHOP',
    startAt: new Date('2026-11-01'),
    endAt: new Date('2026-11-30'),
    status: 'DRAFT',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PromotionCampaignService', () => {
  function buildService() {
    const repo: jest.Mocked<PromotionCampaignRepository> = {
      create: jest.fn(),
      findById: jest.fn(),
      findAllByTenant: jest.fn(),
    };
    const service = new PromotionCampaignService(repo);
    return { service, repo };
  }

  describe('create', () => {
    it('cria quando startAt é anterior a endAt', async () => {
      const { service, repo } = buildService();
      repo.create.mockResolvedValue(buildCampaign());

      await service.create('tenant-1', {
        name: 'Black Friday',
        channelCode: 'NUVEMSHOP',
        startAt: new Date('2026-11-01'),
        endAt: new Date('2026-11-30'),
      });

      expect(repo.create).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        name: 'Black Friday',
        channelCode: 'NUVEMSHOP',
        startAt: new Date('2026-11-01'),
        endAt: new Date('2026-11-30'),
      });
    });

    it('rejeita quando startAt não é anterior a endAt', async () => {
      const { service, repo } = buildService();

      await expect(
        service.create('tenant-1', {
          name: 'Campanha inválida',
          channelCode: 'NUVEMSHOP',
          startAt: new Date('2026-11-30'),
          endAt: new Date('2026-11-01'),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('getOwned', () => {
    it('retorna a campanha quando encontrada', async () => {
      const { service, repo } = buildService();
      repo.findById.mockResolvedValue(buildCampaign());

      const campaign = await service.getOwned('tenant-1', 'campaign-1');

      expect(campaign.id).toBe('campaign-1');
      expect(repo.findById).toHaveBeenCalledWith('tenant-1', 'campaign-1');
    });

    it('lança NotFoundException quando não encontrada (inexistente ou de outro tenant)', async () => {
      const { service, repo } = buildService();
      repo.findById.mockResolvedValue(null);

      await expect(service.getOwned('tenant-1', 'campaign-x')).rejects.toThrow(NotFoundException);
    });
  });
});
