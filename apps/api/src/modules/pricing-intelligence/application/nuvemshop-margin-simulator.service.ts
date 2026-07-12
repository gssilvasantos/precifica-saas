import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PRODUCT_CATALOG_READER, CHANNEL_LISTING_READER, FEE_RULE_RESOLVER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { ChannelListingReader } from '../../../shared/contracts/channel-listing-reader.port';
import { FeeRuleResolver } from '../../../shared/contracts/fee-rule-resolver.port';
import {
  calculateNuvemshopMarginScenario,
  InvalidMarginScenarioError,
  MarginScenarioResult,
} from '../domain/nuvemshop-margin-calculator';

export interface SimulateNuvemshopMarginInput {
  skuCode: string;
  installments: number;
  receivingWindowDays: number;
  freeShipping?: boolean;
  estimatedShippingCost?: number;
  couponCost?: number;
}

export interface SimulateNuvemshopMarginOutput extends MarginScenarioResult {
  skuCode: string;
  productName: string;
  feeRuleFound: boolean; // false = taxa de gateway não cadastrada ainda (API não trouxe e ninguém cadastrou manualmente) — cálculo assumiu 0%
}

// Primeira fatia do Pricing Intelligence — nasceu escopada só para o
// simulador de margem da Nuvemshop (pedido explícito), não é o motor de
// preço completo do PRD (que também vai calcular preço ideal/mínimo por
// SKU x marketplace usando as mesmas 3 portas). Ver README, Etapa 5, seção
// Nuvemshop, para o raciocínio de escopo.
@Injectable()
export class NuvemshopMarginSimulatorService {
  constructor(
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    @Inject(CHANNEL_LISTING_READER) private readonly channelListings: ChannelListingReader,
    @Inject(FEE_RULE_RESOLVER) private readonly feeRules: FeeRuleResolver,
  ) {}

  async simulate(tenantId: string, input: SimulateNuvemshopMarginInput): Promise<SimulateNuvemshopMarginOutput> {
    const product = await this.catalog.findBySku(tenantId, input.skuCode);
    if (!product) {
      throw new BadRequestException(`SKU ${input.skuCode} não encontrado no catálogo desta conta.`);
    }

    const listing = await this.channelListings.findBySku(tenantId, 'NUVEMSHOP', input.skuCode);
    if (!listing || listing.currentPrice === null) {
      throw new BadRequestException(
        `SKU ${input.skuCode} ainda não tem um preço vinculado na Nuvemshop — rode a sincronização de listings ` +
          '(POST /erp-integration/nuvemshop/sync-now) antes de simular.',
      );
    }

    const scopeKey = `${input.installments}x_${input.receivingWindowDays}d`;
    const resolvedFee = await this.feeRules.resolveFeeRule({
      marketplaceCode: 'NUVEMSHOP',
      categoryCode: scopeKey,
      tenantId,
    });

    try {
      const result = calculateNuvemshopMarginScenario({
        grossPrice: listing.currentPrice,
        costPrice: product.costPrice,
        gatewayFeePct: resolvedFee?.commissionPct ?? 0,
        estimatedShippingCost: input.freeShipping ? input.estimatedShippingCost ?? 0 : 0,
        couponCost: input.couponCost,
      });
      return {
        ...result,
        skuCode: input.skuCode,
        productName: product.name,
        feeRuleFound: resolvedFee !== null,
      };
    } catch (error) {
      if (error instanceof InvalidMarginScenarioError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
