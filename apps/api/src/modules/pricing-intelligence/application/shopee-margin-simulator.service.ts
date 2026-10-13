import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PRODUCT_CATALOG_READER, CHANNEL_LISTING_READER, FEE_RULE_RESOLVER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { ChannelListingReader } from '../../../shared/contracts/channel-listing-reader.port';
import { FeeRuleResolver, resolveFeeAtPrice } from '../../../shared/contracts/fee-rule-resolver.port';
import {
  calculateMarketplaceFeeMarginScenario,
  InvalidMarginScenarioError,
  MarketplaceFeeMarginScenarioResult,
} from '../domain/marketplace-fee-margin-calculator';

// Mesmo valor de escopo que ShopeeFeeRuleProvider usa para GRAVAR a regra
// (marketplace-intelligence/infrastructure/providers/shopee/shopee-fee-rule.provider.ts)
// — repetido aqui como literal, não importado de lá: módulo nunca importa
// infraestrutura de outro módulo (.claude/rules/backend.md), só a porta
// (FEE_RULE_RESOLVER). É a mesma convenção que GLOBAL_FEE_SCOPE já usa em
// pricing-decision.service.ts e no simulador do Mercado Livre.
const SHOPEE_FEE_RULE_SCOPE = 'GLOBAL';

export interface SimulateShopeeMarginInput {
  skuCode: string;
}

export interface SimulateShopeeMarginOutput extends MarketplaceFeeMarginScenarioResult {
  skuCode: string;
  productName: string;
  feeRuleFound: boolean; // false = sem regra de comissão VALIDADA ainda — cálculo assumiu taxa 0
}

// Irmã de MercadoLivreMarginSimulatorService, mas mais simples: a Shopee não
// diferencia comissão por categoria nem por tipo de anúncio (ver
// shopee-fee-rule.provider.ts) — só por FAIXA DE PREÇO, que já é resolvida
// dentro de resolveFeeAtPrice a partir de UM escopo fixo ('GLOBAL'), sem
// precisar de CHANNEL_CATEGORY_RESOLVER. Por isso não há parâmetro de
// categoria/tipo de anúncio aqui, ao contrário do simulador do ML.
@Injectable()
export class ShopeeMarginSimulatorService {
  constructor(
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    @Inject(CHANNEL_LISTING_READER) private readonly channelListings: ChannelListingReader,
    @Inject(FEE_RULE_RESOLVER) private readonly feeRules: FeeRuleResolver,
  ) {}

  async simulate(tenantId: string, input: SimulateShopeeMarginInput): Promise<SimulateShopeeMarginOutput> {
    const product = await this.catalog.findBySku(tenantId, input.skuCode);
    if (!product) {
      throw new BadRequestException(`SKU ${input.skuCode} não encontrado no catálogo desta conta.`);
    }

    const listing = await this.channelListings.findBySku(tenantId, 'SHOPEE', input.skuCode);
    if (!listing || listing.currentPrice === null) {
      throw new BadRequestException(
        `SKU ${input.skuCode} ainda não tem um preço vinculado na Shopee — rode a sincronização de anúncios antes de simular.`,
      );
    }

    const resolvedFee = await this.feeRules.resolveFeeRule({
      marketplaceCode: 'SHOPEE',
      categoryCode: SHOPEE_FEE_RULE_SCOPE,
      tenantId,
    });
    const fee = resolvedFee ? resolveFeeAtPrice(resolvedFee, listing.currentPrice) : null;

    try {
      const result = calculateMarketplaceFeeMarginScenario({
        grossPrice: listing.currentPrice,
        costPrice: product.costPrice,
        totalFeeAmount: fee?.totalFeeAmount ?? 0,
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
