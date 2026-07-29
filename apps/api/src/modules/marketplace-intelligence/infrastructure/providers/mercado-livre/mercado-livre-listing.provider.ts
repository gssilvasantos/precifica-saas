import { Injectable, Logger } from '@nestjs/common';
import {
  CategoryDiscoveryCapableProvider,
  CreateListingInput,
  CreateListingResult,
  ExternalCategoryAttribute,
  ExternalCategoryCandidate,
  FetchContext,
  ListingCreateCapableProvider,
  ProviderCapability,
  ProviderHealthStatus,
} from '../../../../../shared/contracts/marketplace-provider.contract';
import { MercadoLivreApiClient } from './mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../application/mercado-livre-connection.service';

// Terceira/quarta capacidade do Mercado Livre (Fase 4, benchmark Tiny ERP) —
// classe SEPARADA de MercadoLivreOrderProvider/MercadoLivreAdsProvider, mesmo
// racional documentado nos outros dois adapters do canal: capacidades
// independentes, nada obriga viverem na mesma classe.
//
// searchCategories/getCategoryAttributes são endpoints PÚBLICOS (não exigem
// OAuth2 de vendedor) — só createListing precisa de um accessToken válido,
// por isso só ele consulta MercadoLivreConnectionService.
@Injectable()
export class MercadoLivreListingProvider implements CategoryDiscoveryCapableProvider, ListingCreateCapableProvider {
  readonly code = 'MERCADO_LIVRE_LISTING';
  readonly marketplaceCode = 'MERCADO_LIVRE';
  readonly sourceType = 'OFFICIAL_API' as const;
  readonly capabilities = [ProviderCapability.CATEGORY_DISCOVERY, ProviderCapability.LISTING_CREATE];

  private readonly logger = new Logger(MercadoLivreListingProvider.name);

  constructor(
    private readonly client: MercadoLivreApiClient,
    private readonly connection: MercadoLivreConnectionService,
  ) {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'UP' };
  }

  async searchCategories(_ctx: FetchContext, query: string): Promise<ExternalCategoryCandidate[]> {
    const raw = await this.client.searchCategories(query);
    return raw.map((r) => ({ externalCategoryId: r.category_id, name: r.category_name }));
  }

  async getCategoryAttributes(_ctx: FetchContext, externalCategoryId: string): Promise<ExternalCategoryAttribute[]> {
    const raw = await this.client.getCategoryAttributes(externalCategoryId);
    return raw.map((a) => ({ name: a.name, required: a.tags?.required === true }));
  }

  // Sempre chamado depois do gate canPublish (domain/listing-publication.entity.ts)
  // já ter validado o payload E o usuário ter confirmado explicitamente a
  // publicação (ListingPublicationService) — nunca automaticamente.
  async createListing(ctx: FetchContext, input: CreateListingInput): Promise<CreateListingResult> {
    if (!ctx.tenantId) {
      return { success: false, message: 'Publicar anúncio sempre exige tenantId (é sempre por vendedor).' };
    }
    try {
      const accessToken = await this.connection.getValidAccessToken(ctx.tenantId);
      const result = await this.client.createItem(accessToken, {
        title: input.title,
        category_id: input.externalCategoryId,
        price: input.price,
        currency_id: input.currency,
        available_quantity: input.availableQuantity,
        buying_mode: 'buy_it_now',
        condition: 'new',
        listing_type_id: 'gold_special',
        pictures: input.pictureUrls.map((url) => ({ source: url })),
        attributes: this.toMlAttributes(input.attributes),
      });
      if (!result.id) {
        return { success: false, message: result.message ?? 'Mercado Livre não devolveu um id de anúncio.' };
      }
      return { success: true, externalListingId: result.id };
    } catch (error) {
      this.logger.warn(`Falha ao publicar anúncio no Mercado Livre (tenant ${ctx.tenantId}): ${(error as Error).message}`);
      return { success: false, message: (error as Error).message };
    }
  }

  // O Mercado Livre identifica atributos por `id` (ex.: "BRAND"), não por
  // nome livre — mas o modelo interno (CategoryAttribute) guarda o NOME do
  // atributo (mesmo texto que aparece em getCategoryAttributes), então
  // reaproveitamos o próprio nome como id: é exatamente o valor que
  // getCategoryAttributes devolveu e que o usuário viu ao configurar o
  // ChannelCategoryMapping — nunca inventa um mapeamento nome->id paralelo.
  private toMlAttributes(attributes: Record<string, string>): { id: string; value_name: string }[] {
    return Object.entries(attributes).map(([name, value]) => ({ id: name, value_name: value }));
  }
}
