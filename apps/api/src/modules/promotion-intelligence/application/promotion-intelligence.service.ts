import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRODUCT_CATALOG_READER, FEE_RULE_RESOLVER, FINANCIAL_POLICY_READER, LOGISTICS_COST_READER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { FeeRuleResolver } from '../../../shared/contracts/fee-rule-resolver.port';
import { FinancialPolicyReader } from '../../../shared/contracts/financial-policy-reader.port';
import { LogisticsCostReader } from '../../../shared/contracts/logistics-cost-reader.port';
import { PROMOTION_ENROLLMENT_REPOSITORY, PromotionEnrollmentRepository } from './ports/promotion-enrollment-repository.port';
import { PromotionCampaignService } from './promotion-campaign.service';
import { calculateNetMargin, canEnrollInPromotion, InvalidMarginInputsError, MarginStatus } from '../domain/margin-calculator';
import { PromotionEnrollment } from '../domain/promotion-enrollment.entity';

// Categoria usada para resolver a regra de taxa do canal (FEE_RULE_RESOLVER)
// quando o produto não tem uma categoria de marketplace própria (Product
// não tem esse campo hoje). Mesmo racional do NuvemshopMarginSimulatorService,
// que também usa uma scopeKey própria (installments_window) em vez de uma
// categoria de produto real — aqui, "GLOBAL" é a convenção para regras de
// taxa que valem para qualquer categoria de um canal.
const DEFAULT_FEE_CATEGORY = 'GLOBAL';

export interface MarginPreview {
  skuCode: string;
  channelCode: string;
  promotionalPrice: number;
  costPriceUsed: number;
  feesAmount: number;
  taxAmount: number;
  logisticsCost: number;
  netMarginAmount: number;
  netMarginPct: number;
  marginStatus: MarginStatus;
  // false = FEE_RULE_RESOLVER não encontrou regra cadastrada para o canal —
  // feesAmount assumiu 0, então a margem calculada pode estar otimista.
  // Mesmo alerta que NuvemshopMarginSimulatorService.feeRuleFound já dá hoje.
  feeRuleFound: boolean;
}

// "Motor de Cálculo de Margem" (Sprint 26) — dado um preço promocional e um
// canal, calcula a M.C. Líquida (Preço - Taxas - Custos - Logística) e
// classifica VERDE/VERMELHO ("Semáforo de Margem"). Reaproveita 3 portas já
// existentes (nunca duplica): FEE_RULE_RESOLVER (taxa do canal),
// FINANCIAL_POLICY_READER (imposto do tenant), LOGISTICS_COST_READER
// (embalagem + operacional do Warehouse Full) — só ConfiguracaoCanal NÃO
// existe como entidade própria porque as duas peças que ela cobriria já
// têm dono (MarketplaceRule e CatalogSettings).
@Injectable()
export class PromotionIntelligenceService {
  constructor(
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    @Inject(FEE_RULE_RESOLVER) private readonly feeRules: FeeRuleResolver,
    @Inject(FINANCIAL_POLICY_READER) private readonly financialPolicy: FinancialPolicyReader,
    @Inject(LOGISTICS_COST_READER) private readonly logistics: LogisticsCostReader,
    @Inject(PROMOTION_ENROLLMENT_REPOSITORY) private readonly enrollments: PromotionEnrollmentRepository,
    private readonly campaigns: PromotionCampaignService,
  ) {}

  // Cálculo puro de leitura — não grava nada. Usado tanto pela pré-visualização
  // (simular antes de decidir aderir) quanto por validateEnrollment abaixo.
  async computeMargin(tenantId: string, skuCode: string, channelCode: string, promotionalPrice: number): Promise<MarginPreview> {
    const product = await this.catalog.findBySku(tenantId, skuCode);
    if (!product) {
      throw new NotFoundException(`SKU ${skuCode} não encontrado no catálogo desta conta.`);
    }

    const [feeRule, policy, logisticsCost] = await Promise.all([
      this.feeRules.resolveFeeRule({ marketplaceCode: channelCode, categoryCode: DEFAULT_FEE_CATEGORY, tenantId }),
      this.financialPolicy.getPolicy(tenantId),
      this.logistics.getTotalLogisticsCost(tenantId, skuCode, channelCode),
    ]);

    try {
      const result = calculateNetMargin({
        promotionalPrice,
        costPrice: product.productCostPrice, // SEM embalagem — já está em logisticsCost
        commissionPct: feeRule?.commissionPct ?? 0,
        fixedFeeAmount: feeRule?.fixedFeeAmount ?? 0,
        taxRate: policy.taxRate,
        logisticsCost,
      });

      return {
        skuCode,
        channelCode,
        promotionalPrice,
        costPriceUsed: product.productCostPrice,
        feesAmount: result.feesAmount,
        taxAmount: result.taxAmount,
        logisticsCost,
        netMarginAmount: result.netMarginAmount,
        netMarginPct: result.netMarginPct,
        marginStatus: result.marginStatus,
        feeRuleFound: feeRule !== null,
      };
    } catch (error) {
      if (error instanceof InvalidMarginInputsError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  // "Validação Proativa" pedida pelo usuário — bloqueia ANTES de gravar
  // qualquer adesão com margem negativa. Sempre persiste um snapshot
  // (APPROVED ou BLOCKED, nunca deixa PENDING no banco) — mesmo racional de
  // "nunca fabricar um estado intermediário" já usado em toda a plataforma
  // (ex.: StockMovementAuditEvent só existe PENDENTE/APROVADO/DIVERGENTE
  // como fato já ocorrido, nunca um limbo).
  async validateEnrollment(
    tenantId: string,
    campaignId: string,
    skuCode: string,
    promotionalPrice: number,
  ): Promise<PromotionEnrollment> {
    const campaign = await this.campaigns.getOwned(tenantId, campaignId);
    const preview = await this.computeMargin(tenantId, skuCode, campaign.channelCode, promotionalPrice);
    const gate = canEnrollInPromotion({
      feesAmount: preview.feesAmount,
      taxAmount: preview.taxAmount,
      netMarginAmount: preview.netMarginAmount,
      netMarginPct: preview.netMarginPct,
      marginStatus: preview.marginStatus,
    });

    return this.enrollments.create({
      tenantId,
      campaignId,
      skuCode,
      promotionalPrice,
      costPriceUsed: preview.costPriceUsed,
      feesAmount: preview.feesAmount,
      taxAmount: preview.taxAmount,
      logisticsCost: preview.logisticsCost,
      netMarginAmount: preview.netMarginAmount,
      netMarginPct: preview.netMarginPct,
      marginStatus: preview.marginStatus,
      enrollmentStatus: gate.allowed ? 'APPROVED' : 'BLOCKED',
      blockedReason: gate.reason,
      feeRuleFound: preview.feeRuleFound,
    });
  }

  async listEnrollments(tenantId: string, campaignId: string): Promise<PromotionEnrollment[]> {
    await this.campaigns.getOwned(tenantId, campaignId); // valida posse antes de listar
    return this.enrollments.findAllByCampaign(tenantId, campaignId);
  }
}
