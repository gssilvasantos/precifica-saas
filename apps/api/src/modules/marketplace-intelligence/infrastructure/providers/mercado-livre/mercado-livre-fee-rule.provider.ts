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
import { buildFeeScopeKey } from '../../../domain/marketplace-rule.entity';

// Grade de preços sondada para descobrir as FAIXAS de comissão
// (01/08/2026 — ver docs/marketplace-fee-model-architecture.md, §4.1).
//
// Antes, o provider capturava a taxa num único ponto (R$100) e assumia que
// ela valia para todo preço. Não vale: o Mercado Livre tem limiar em R$79
// (abaixo dele há custo por unidade; acima, frete grátis obrigatório), e a
// comissão pode variar por faixa. Aplicar a taxa de R$100 a um produto de
// R$40 erra a conta.
//
// O `listing_prices` responde para UM preço por vez, então a única forma de
// descobrir a tabela é sondar e agrupar preços consecutivos com a mesma
// comissão numa faixa só. É engenharia reversa, mas determinística: a API é
// pública e responde sempre igual para o mesmo par (categoria, preço).
//
// Os pontos foram escolhidos em torno dos limiares conhecidos (19 e 79) e
// espaçados o bastante para cobrir o catálogo típico sem explodir o número
// de chamadas. Sondar mais pontos aumenta a resolução da tabela ao custo
// de mais chamadas — é o trade-off a mexer se aparecer um canal com faixas
// mais finas.
const PROBE_PRICES = [15, 25, 50, 78, 100, 200, 500, 1000];

// Tipos de anúncio capturados. A diferença entre Clássico (10-14%) e
// Premium (15-19%) chega a 5 pontos percentuais — maior que a variação
// entre muitas categorias. Capturar só um dos dois e aplicar ao outro é um
// erro maior do que ignorar a categoria.
const LISTING_TYPES = ['gold_special', 'gold_pro'] as const;

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
      for (const listingTypeId of LISTING_TYPES) {
        try {
          const candidate = await this.buildCandidateForListingType(category.id, listingTypeId, fetchedAt);
          if (candidate) candidates.push(candidate);
        } catch (error) {
          // Resiliência parcial: uma categoria/tipo com erro não derruba o
          // lote inteiro — o mesmo critério de antes, agora por par
          // (categoria, tipo de anúncio).
          this.logger.error(
            `Falha ao montar tabela de taxas de ${category.id}/${listingTypeId}: ${(error as Error).message}`,
          );
        }
      }
    }

    return candidates;
  }

  // Sonda a grade de preços para UM par (categoria, tipo de anúncio) e
  // devolve a tabela de faixas já agrupada.
  private async buildCandidateForListingType(
    categoryId: string,
    listingTypeId: string,
    fetchedAt: Date,
  ): Promise<RawRuleCandidate | null> {
    const probes: { price: number; commissionPct: number; fixedFeeAmount: number }[] = [];

    for (const price of PROBE_PRICES) {
      const prices = await this.client.fetchListingPrices(categoryId, price);
      const listing = prices.find((p) => p.listing_type_id === listingTypeId);

      // Tipo de anúncio indisponível naquela categoria é situação normal
      // (nem toda categoria oferece Premium) — não é erro, só não há o que
      // capturar.
      if (!listing?.sale_fee_details) continue;

      probes.push({
        price,
        // CONVERSÃO DE UNIDADE NA BORDA: a API devolve percentual (11.5), o
        // sistema inteiro trabalha em fração (0.115). Ver
        // docs/marketplace-fee-model-architecture.md, §3.2 — a ausência
        // desta divisão era um bug latente que teria quebrado o motor de
        // preço e o de promoções na primeira regra real importada.
        commissionPct: (listing.sale_fee_details.percentage_fee ?? 0) / 100,
        fixedFeeAmount: listing.sale_fee_details.fixed_fee ?? 0,
      });
    }

    if (probes.length === 0) {
      this.logger.debug(`Categoria ${categoryId} não expõe o tipo de anúncio ${listingTypeId} — nada a capturar.`);
      return null;
    }

    return {
      scopeKey: buildFeeScopeKey(categoryId, listingTypeId),
      payload: {
        tiers: groupProbesIntoTiers(probes),
        commissionBase: 'ITEM_PRICE',
        listingTypeId,
      },
      sourceEvidenceRef:
        `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${categoryId}` +
        ` (sondado em ${PROBE_PRICES.join(', ')} para listing_type_id=${listingTypeId})`,
      fetchedAt,
    };
  }
}

// Agrupa sondagens consecutivas com a MESMA taxa numa única faixa. Função
// pura e exportada para ser testável sem rede — é a peça que transforma
// pontos amostrados numa tabela contínua.
//
// A primeira faixa sempre começa em 0 (mesmo que a menor sondagem tenha
// sido a R$15): abaixo do primeiro ponto sondado, a suposição mais segura é
// que vale a mesma taxa do ponto mais baixo observado. A última sempre
// termina em null (sem teto), pelo mesmo motivo, do outro lado. O validador
// exige exatamente isso — cobertura de 0 ao infinito, sem buraco.
export function groupProbesIntoTiers(
  probes: { price: number; commissionPct: number; fixedFeeAmount: number }[],
): { minPrice: number; maxPrice: number | null; commissionPct: number; fixedFeeAmount: number }[] {
  const sorted = [...probes].sort((a, b) => a.price - b.price);
  const tiers: { minPrice: number; maxPrice: number | null; commissionPct: number; fixedFeeAmount: number }[] = [];

  for (const probe of sorted) {
    const last = tiers[tiers.length - 1];
    const sameAsLast =
      last && last.commissionPct === probe.commissionPct && last.fixedFeeAmount === probe.fixedFeeAmount;

    if (sameAsLast) continue; // estende a faixa atual — nada a fazer até a taxa mudar

    if (last) last.maxPrice = probe.price;
    tiers.push({
      minPrice: tiers.length === 0 ? 0 : probe.price,
      maxPrice: null,
      commissionPct: probe.commissionPct,
      fixedFeeAmount: probe.fixedFeeAmount,
    });
  }

  return tiers;
}
