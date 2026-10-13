import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PRODUCT_CATALOG_READER, CHANNEL_LISTING_READER, FEE_RULE_RESOLVER, CHANNEL_CATEGORY_RESOLVER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { ChannelListingReader } from '../../../shared/contracts/channel-listing-reader.port';
import { FeeRuleResolver, resolveFeeAtPrice } from '../../../shared/contracts/fee-rule-resolver.port';
import { ChannelCategoryResolver } from '../../../shared/contracts/channel-category-resolver.port';
import {
  calculateMarketplaceFeeMarginScenario,
  InvalidMarginScenarioError,
  MarketplaceFeeMarginScenarioResult,
} from '../domain/marketplace-fee-margin-calculator';

const GLOBAL_FEE_SCOPE = 'GLOBAL';

// 'gold_special' = Clássico, 'gold_pro' = Premium — mesmos valores que
// MercadoLivreFeeRuleProvider sonda e MercadoLivreListingProvider usa ao
// publicar (ver mercado-livre-listing.provider.ts, createListing). Clássico
// é o padrão por ser o tipo de anúncio mais comum — quem quiser comparar com
// Premium passa listingTypeId explicitamente.
const DEFAULT_LISTING_TYPE_ID = 'gold_special';

export interface SimulateMercadoLivreMarginInput {
  skuCode: string;
  listingTypeId?: string;
}

export interface SimulateMercadoLivreMarginOutput extends MarketplaceFeeMarginScenarioResult {
  skuCode: string;
  productName: string;
  listingTypeId: string;
  feeRuleFound: boolean; // false = sem regra de comissão VALIDADA para este SKU ainda — cálculo assumiu taxa 0
}

// Irmã de NuvemshopMarginSimulatorService (mesma forma, mesmo racional),
// para o Mercado Livre — segundo canal do pedido do Gui (13/10/2026: "ML e
// Shopee já estão conectados [ChannelListing], mas o cálculo de margem não
// funciona"). Diferença estrutural real (não é só renomear): a comissão do
// ML varia por CATEGORIA (não por parcelas/janela de recebimento como a
// Nuvemshop), então a resolução da taxa precisa traduzir a categoria
// INTERNA do produto para a categoria do CANAL antes de consultar o
// FEE_RULE_RESOLVER — exatamente o mesmo caminho que PricingDecisionService
// já percorre (resolveFeeRule, ver pricing-decision.service.ts) para decidir
// o piso de preço automático. Esta classe é a versão "simulador" dele: só
// lê e devolve o cenário, nunca decide nem aplica preço.
@Injectable()
export class MercadoLivreMarginSimulatorService {
  constructor(
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    @Inject(CHANNEL_LISTING_READER) private readonly channelListings: ChannelListingReader,
    @Inject(FEE_RULE_RESOLVER) private readonly feeRules: FeeRuleResolver,
    @Inject(CHANNEL_CATEGORY_RESOLVER) private readonly channelCategories: ChannelCategoryResolver,
  ) {}

  async simulate(tenantId: string, input: SimulateMercadoLivreMarginInput): Promise<SimulateMercadoLivreMarginOutput> {
    const product = await this.catalog.findBySku(tenantId, input.skuCode);
    if (!product) {
      throw new BadRequestException(`SKU ${input.skuCode} não encontrado no catálogo desta conta.`);
    }

    const listing = await this.channelListings.findBySku(tenantId, 'MERCADO_LIVRE', input.skuCode);
    if (!listing || listing.currentPrice === null) {
      throw new BadRequestException(
        `SKU ${input.skuCode} ainda não tem um preço vinculado no Mercado Livre — rode a sincronização de anúncios antes de simular.`,
      );
    }

    const listingTypeId = input.listingTypeId ?? DEFAULT_LISTING_TYPE_ID;
    const resolvedFee = await this.resolveFeeRule(tenantId, product.categoryId, listingTypeId);
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
        listingTypeId,
        feeRuleFound: resolvedFee !== null,
      };
    } catch (error) {
      if (error instanceof InvalidMarginScenarioError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  // Mesmo caminho "categoria -> escopo global" de
  // PricingDecisionService.resolveFeeRule (pricing-decision.service.ts) —
  // deliberadamente duplicado em vez de extraído para um helper comum: são
  // dois consumidores com motivos de existir diferentes (decisão automática
  // de preço vs. simulação sob pedido) e esta é só a segunda vez que o
  // padrão aparece. Extrair um helper compartilhado é a próxima ação óbvia
  // se aparecer uma terceira (ver .claude/skills/product-engineering-studio,
  // "Fatias verticais" — duplicação localizada aqui é mais barata que uma
  // abstração prematura).
  private async resolveFeeRule(tenantId: string, internalCategoryId: string | null, listingTypeId: string) {
    if (internalCategoryId) {
      const externalCategoryId = await this.channelCategories.resolveExternalCategoryId(
        tenantId,
        internalCategoryId,
        'MERCADO_LIVRE',
      );
      if (externalCategoryId) {
        const byCategory = await this.feeRules.resolveFeeRule({
          marketplaceCode: 'MERCADO_LIVRE',
          categoryCode: externalCategoryId,
          tenantId,
          listingTypeId,
        });
        if (byCategory) return byCategory;
      }
    }
    return this.feeRules.resolveFeeRule({
      marketplaceCode: 'MERCADO_LIVRE',
      categoryCode: GLOBAL_FEE_SCOPE,
      tenantId,
      listingTypeId,
    });
  }
}
