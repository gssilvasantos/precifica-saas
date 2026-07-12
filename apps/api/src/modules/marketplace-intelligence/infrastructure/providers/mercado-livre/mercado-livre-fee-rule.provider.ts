import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import {
  AuthenticatedProvider,
  ExternalListing,
  FeeRuleCapableProvider,
  FetchContext,
  ListingCapableProvider,
  PriceUpdateCapableProvider,
  PriceUpdateResult,
  ProviderCapability,
  ProviderHealthStatus,
  RawRuleCandidate,
} from '../../../../../shared/contracts/marketplace-provider.contract';
import { MercadoLivreApiClient } from './mercado-livre-api.client';

// Preço de referência usado para consultar a comissão por categoria. A
// comissão do Mercado Livre pode variar por faixa de preço (ver PRD,
// pesquisa de mercado) — esta primeira versão do provider captura a taxa no
// ponto de referência R$100, que cobre a maioria dos SKUs do catálogo atual.
// Granularidade completa (múltiplas faixas de preço por categoria) fica
// para uma iteração futura — não bloqueia a arquitetura, que já suporta
// scopeKey mais granular quando isso for necessário.
const REFERENCE_PRICE = 100;

// Um provider, três capacidades (Interface Segregation: cada uma é uma
// interface própria — FeeRuleCapableProvider, ListingCapableProvider,
// PriceUpdateCapableProvider — implementadas pela MESMA classe porque é o
// mesmo canal, mas nada obriga isso; um provider futuro pode implementar só
// uma). FEE_RULES está funcional desde a Etapa 4 (endpoints públicos, sem
// OAuth). LISTINGS e PRICE_UPDATE são a extensão pedida agora: a estrutura
// já existe, mas as chamadas reais exigem OAuth2 por vendedor (Mercado
// Livre não expõe "listar meus anúncios" nem "atualizar preço" em endpoint
// público) — por isso os dois métodos abaixo lançam NotImplementedException
// com uma mensagem explícita, em vez de fingir uma implementação que
// quebraria em produção. Implementar isso de verdade é o próximo passo
// natural: usar AuthStrategy (shared/contracts/auth-strategy.contract.ts,
// tipo OAUTH2/scope TENANT) para obter o token do vendedor antes da chamada.
@Injectable()
export class MercadoLivreFeeRuleProvider
  implements FeeRuleCapableProvider, ListingCapableProvider, PriceUpdateCapableProvider, AuthenticatedProvider
{
  readonly code = 'MERCADO_LIVRE_API_V1';
  readonly marketplaceCode = 'MERCADO_LIVRE';
  readonly sourceType = 'OFFICIAL_API' as const;
  readonly capabilities = [ProviderCapability.FEE_RULES, ProviderCapability.LISTINGS, ProviderCapability.PRICE_UPDATE];
  readonly authScope = 'TENANT' as const;

  private readonly logger = new Logger(MercadoLivreFeeRuleProvider.name);

  constructor(private readonly client: MercadoLivreApiClient) {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    try {
      await this.client.fetchTopLevelCategories();
      return { status: 'UP' };
    } catch (error) {
      return { status: 'DOWN', message: (error as Error).message };
    }
  }

  // Ponto único de entrada de autenticação por tenant — hoje só valida que
  // ela ainda não existe (lança um erro claro). Quando o fluxo OAuth2 do
  // Mercado Livre for implementado, esta é a única função que muda; nem
  // listActiveListings nem updatePrice precisam saber como o token é obtido.
  async ensureValidCredentials(_tenantId?: string): Promise<void> {
    throw new NotImplementedException(
      'Autenticação OAuth2 por vendedor do Mercado Livre ainda não foi implementada — ' +
        'listActiveListings/updatePrice exigem isso antes de funcionar de verdade.',
    );
  }

  async listActiveListings(ctx: FetchContext): Promise<ExternalListing[]> {
    await this.ensureValidCredentials(ctx.tenantId); // lança — ver comentário da classe
    return [];
  }

  async updatePrice(ctx: FetchContext, externalId: string, newPrice: number): Promise<PriceUpdateResult> {
    await this.ensureValidCredentials(ctx.tenantId); // lança — ver comentário da classe
    return { success: false, externalId, message: 'Não implementado — requer OAuth2 por vendedor.' };
  }

  async fetchFeeRules(_ctx: FetchContext): Promise<RawRuleCandidate[]> {
    const categories = await this.client.fetchTopLevelCategories();
    const fetchedAt = new Date();
    const candidates: RawRuleCandidate[] = [];

    for (const category of categories) {
      try {
        const prices = await this.client.fetchListingPrices(category.id, REFERENCE_PRICE);
        // Prioriza o tipo de anúncio "Clássico" (gold_special); cai para o
        // primeiro item retornado se esse tipo específico não vier na resposta.
        const listing =
          prices.find((p) => p.listing_type_id === 'gold_special') ?? prices[0];

        if (!listing?.sale_fee_details) {
          this.logger.warn(
            `Categoria ${category.id} sem sale_fee_details na resposta — pulando (payload inválido será rejeitado pelo validator de qualquer forma).`,
          );
          continue;
        }

        candidates.push({
          scopeKey: category.id,
          payload: {
            commissionPct: listing.sale_fee_details.percentage_fee ?? 0,
            fixedFeeAmount: listing.sale_fee_details.fixed_fee ?? 0,
            referencePrice: REFERENCE_PRICE,
            listingTypeId: listing.listing_type_id,
          },
          sourceEvidenceRef: `https://api.mercadolibre.com/sites/MLB/listing_prices?price=${REFERENCE_PRICE}&category_id=${category.id}`,
          fetchedAt,
        });
      } catch (error) {
        // Resiliência parcial: uma categoria com erro não derruba o lote inteiro.
        this.logger.error(`Falha ao buscar listing_prices de ${category.id}: ${(error as Error).message}`);
      }
    }

    return candidates;
  }
}
