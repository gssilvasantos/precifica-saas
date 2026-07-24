import { NotFoundException } from '@nestjs/common';
import { PromotionIntelligenceService } from './promotion-intelligence.service';
import { PromotionCampaignService } from './promotion-campaign.service';
import { PromotionEnrollmentRepository } from './ports/promotion-enrollment-repository.port';
import { PromotionCampaignRepository } from './ports/promotion-campaign-repository.port';
import { ProductCatalogReader, ProductCatalogSummary } from '../../../shared/contracts/product-catalog-reader.port';
import { FeeRuleResolver } from '../../../shared/contracts/fee-rule-resolver.port';
import { FinancialPolicy, FinancialPolicyReader } from '../../../shared/contracts/financial-policy-reader.port';
import { LogisticsCostReader } from '../../../shared/contracts/logistics-cost-reader.port';
import { PromotionCampaign } from '../domain/promotion-campaign.entity';

function buildProduct(overrides: Partial<ProductCatalogSummary> = {}): ProductCatalogSummary {
  return {
    productId: 'prod-1',
    skuCode: 'SKU-1',
    name: 'Produto',
    costPrice: 40,
    productCostPrice: 40,
    packagingCostPrice: null,
    desiredMarginPct: 20,
    minimumMarginPct: 8,
    autoRepricingEnabled: false,
    packagingId: null,
    isKit: false,
    mapPrice: null,
    ...overrides,
  };
}

function buildCampaign(overrides: Partial<PromotionCampaign> = {}): PromotionCampaign {
  return {
    id: 'campaign-1',
    tenantId: 'tenant-1',
    name: 'Black Friday',
    channelCode: 'NUVEMSHOP',
    startAt: new Date('2026-11-01'),
    endAt: new Date('2026-11-30'),
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PromotionIntelligenceService', () => {
  function buildService(product: ProductCatalogSummary | null = buildProduct(), logisticsCost = 10, noFeeRule = false) {
    const catalog: jest.Mocked<ProductCatalogReader> = { findBySku: jest.fn().mockResolvedValue(product) };
    const feeRules: jest.Mocked<FeeRuleResolver> = {
      resolveFeeRule: jest.fn().mockResolvedValue(
        noFeeRule ? null : { commissionPct: 0.12, fixedFeeAmount: 2, ruleId: 'rule-1', ruleVersion: 1 },
      ),
    };
    const financialPolicy: jest.Mocked<FinancialPolicyReader> = {
      getPolicy: jest.fn().mockResolvedValue({ taxRate: 0.06, minProfitMargin: 0, targetRoas: 3 } as FinancialPolicy),
    };
    const logistics: jest.Mocked<LogisticsCostReader> = {
      getTotalLogisticsCost: jest.fn().mockResolvedValue(logisticsCost),
      getPackagingCostForOrder: jest.fn(),
    };
    const enrollmentRepo: jest.Mocked<PromotionEnrollmentRepository> = {
      create: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'enrollment-1', computedAt: new Date(), ...data })),
      findByCampaignAndSku: jest.fn(),
      findAllByCampaign: jest.fn(),
    };
    const campaignRepo: jest.Mocked<PromotionCampaignRepository> = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(buildCampaign()),
      findAllByTenant: jest.fn(),
    };
    const campaigns = new PromotionCampaignService(campaignRepo);
    const service = new PromotionIntelligenceService(catalog, feeRules, financialPolicy, logistics, enrollmentRepo, campaigns);
    return { service, catalog, feeRules, financialPolicy, logistics, enrollmentRepo, campaignRepo };
  }

  describe('computeMargin', () => {
    it('calcula a M.C. Líquida = Preço - Taxas - Custos - Logística e classifica VERDE', async () => {
      const { service } = buildService(buildProduct({ productCostPrice: 40 }), 10);

      // preço 100: fees = 100*0.12+2 = 14, tax = 6, custo 40, logistica 10 -> margem 30
      const preview = await service.computeMargin('tenant-1', 'SKU-1', 'NUVEMSHOP', 100);

      expect(preview.feesAmount).toBeCloseTo(14);
      expect(preview.taxAmount).toBeCloseTo(6);
      expect(preview.netMarginAmount).toBeCloseTo(30);
      expect(preview.marginStatus).toBe('VERDE');
      expect(preview.feeRuleFound).toBe(true);
    });

    it('classifica VERMELHO quando a margem é negativa', async () => {
      const { service } = buildService(buildProduct({ productCostPrice: 90 }), 10);

      const preview = await service.computeMargin('tenant-1', 'SKU-1', 'NUVEMSHOP', 100);

      expect(preview.marginStatus).toBe('VERMELHO');
    });

    it('sem regra de taxa cadastrada para o canal: assume fee 0 e sinaliza feeRuleFound=false (nunca esconde a lacuna)', async () => {
      const { service } = buildService(buildProduct(), 10, true);

      const preview = await service.computeMargin('tenant-1', 'SKU-1', 'NUVEMSHOP', 100);

      expect(preview.feesAmount).toBe(0);
      expect(preview.feeRuleFound).toBe(false);
    });

    it('SKU inexistente no catálogo: lança NotFoundException', async () => {
      const { service } = buildService(null);

      await expect(service.computeMargin('tenant-1', 'SKU-FANTASMA', 'NUVEMSHOP', 100)).rejects.toThrow(NotFoundException);
    });

    it('usa o custo composto do LogisticsCostReader (embalagem + operacional), nunca um valor fixo', async () => {
      const { service, logistics } = buildService(buildProduct(), 25);

      const preview = await service.computeMargin('tenant-1', 'SKU-1', 'NUVEMSHOP', 100);

      expect(logistics.getTotalLogisticsCost).toHaveBeenCalledWith('tenant-1', 'SKU-1', 'NUVEMSHOP');
      expect(preview.logisticsCost).toBe(25);
    });
  });

  describe('validateEnrollment', () => {
    it('margem VERDE: grava enrollmentStatus APPROVED, sem blockedReason', async () => {
      const { service, enrollmentRepo } = buildService(buildProduct({ productCostPrice: 40 }), 10);

      const enrollment = await service.validateEnrollment('tenant-1', 'campaign-1', 'SKU-1', 100);

      expect(enrollment.enrollmentStatus).toBe('APPROVED');
      expect(enrollment.blockedReason).toBeNull();
      expect(enrollmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ enrollmentStatus: 'APPROVED', marginStatus: 'VERDE', campaignId: 'campaign-1', skuCode: 'SKU-1' }),
      );
    });

    it('Validação Proativa: margem VERMELHO bloqueia a adesão (enrollmentStatus BLOCKED, com motivo)', async () => {
      const { service, enrollmentRepo } = buildService(buildProduct({ productCostPrice: 200 }), 10);

      const enrollment = await service.validateEnrollment('tenant-1', 'campaign-1', 'SKU-1', 100);

      expect(enrollment.enrollmentStatus).toBe('BLOCKED');
      expect(enrollment.blockedReason).toMatch(/bloqueada/);
      expect(enrollmentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ enrollmentStatus: 'BLOCKED' }));
    });

    it('resolve o canal da campanha (nunca pede o canal de novo ao chamador)', async () => {
      const { service, logistics, campaignRepo } = buildService(buildProduct(), 10);
      campaignRepo.findById.mockResolvedValue(buildCampaign({ channelCode: 'MERCADO_LIVRE' }));

      await service.validateEnrollment('tenant-1', 'campaign-1', 'SKU-1', 100);

      expect(logistics.getTotalLogisticsCost).toHaveBeenCalledWith('tenant-1', 'SKU-1', 'MERCADO_LIVRE');
    });

    it('campanha inexistente ou de outro tenant: lança NotFoundException, nunca chama o motor de margem', async () => {
      const { service, campaignRepo, catalog } = buildService();
      campaignRepo.findById.mockResolvedValue(null);

      await expect(service.validateEnrollment('tenant-1', 'campaign-inexistente', 'SKU-1', 100)).rejects.toThrow(NotFoundException);
      expect(catalog.findBySku).not.toHaveBeenCalled();
    });
  });
});
