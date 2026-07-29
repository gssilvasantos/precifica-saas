import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
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
import { ShopeeApiClient } from './shopee-api-client';
import { ShopeeConnectionService } from '../../../application/shopee-connection.service';

// Quarta/quinta capacidade da Shopee (Fase 4, benchmark Tiny ERP) — classe
// SEPARADA de ShopeeOrderProvider/ShopeeConnectionService, mesmo racional
// documentado no Mercado Livre (MercadoLivreListingProvider).
//
// Diferença estrutural do ML: get_category/get_attributes da Shopee são
// endpoints PÚBLICOS (assinatura partner-level, sem access_token/shop_id) —
// só createListing precisa de token+loja de fato.
@Injectable()
export class ShopeeListingProvider implements CategoryDiscoveryCapableProvider, ListingCreateCapableProvider {
  readonly code = 'SHOPEE_LISTING';
  readonly marketplaceCode = 'SHOPEE';
  readonly sourceType = 'OFFICIAL_API' as const;
  readonly capabilities = [ProviderCapability.CATEGORY_DISCOVERY, ProviderCapability.LISTING_CREATE];

  private readonly logger = new Logger(ShopeeListingProvider.name);

  constructor(
    private readonly client: ShopeeApiClient,
    private readonly connection: ShopeeConnectionService,
  ) {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'UP' };
  }

  // A Shopee só expõe a árvore INTEIRA de categorias (sem busca por texto no
  // próprio endpoint) — filtragem por substring do nome é feita aqui, nunca
  // no provider do Mercado Livre (que já recebe candidatos filtrados pela
  // própria API do canal).
  async searchCategories(_ctx: FetchContext, query: string): Promise<ExternalCategoryCandidate[]> {
    const all = await this.client.getCategoryList(this.requireEnv('SHOPEE_PARTNER_ID'), this.requireEnv('SHOPEE_PARTNER_KEY'));
    const normalizedQuery = query.trim().toLowerCase();
    return all
      .filter((c) => c.category_name.toLowerCase().includes(normalizedQuery))
      .slice(0, 10)
      .map((c) => ({ externalCategoryId: String(c.category_id), name: c.category_name }));
  }

  async getCategoryAttributes(_ctx: FetchContext, externalCategoryId: string): Promise<ExternalCategoryAttribute[]> {
    const raw = await this.client.getCategoryAttributes(this.requireEnv('SHOPEE_PARTNER_ID'), this.requireEnv('SHOPEE_PARTNER_KEY'), externalCategoryId);
    return raw.map((a) => ({ name: a.original_attribute_name, required: a.is_mandatory }));
  }

  // Sempre chamado depois do gate canPublish já ter validado o payload E o
  // usuário ter confirmado explicitamente a publicação (ListingPublicationService)
  // — nunca automaticamente.
  async createListing(ctx: FetchContext, input: CreateListingInput): Promise<CreateListingResult> {
    if (!ctx.tenantId) {
      return { success: false, message: 'Publicar anúncio sempre exige tenantId (é sempre por loja).' };
    }
    try {
      const partnerId = this.requireEnv('SHOPEE_PARTNER_ID');
      const partnerKey = this.requireEnv('SHOPEE_PARTNER_KEY');
      const accessToken = await this.connection.getValidAccessToken(ctx.tenantId);
      const shopId = await this.connection.getShopId(ctx.tenantId);
      if (!shopId) {
        return { success: false, message: `Nenhuma loja Shopee conectada para o tenant ${ctx.tenantId}.` };
      }

      // Imagem precisa estar hospedada NA Shopee antes do anúncio referenciá-la
      // (diferente do Mercado Livre, que aceita URL externa direto) — ver
      // uploadImage em shopee-api-client.ts.
      const imageIds: string[] = [];
      for (const url of input.pictureUrls) {
        imageIds.push(await this.client.uploadImage(partnerId, partnerKey, shopId, accessToken, url));
      }

      // A Shopee identifica atributo por `attribute_id` NUMÉRICO, não por
      // nome (diferente do ML) — resolvido aqui a partir do NOME que o
      // usuário configurou no ChannelCategoryMapping, nunca inventado.
      // Atributo sem correspondência na categoria é descartado com aviso
      // (nunca falha a publicação inteira por causa disso — o gate
      // canPublish já garantiu que os atributos OBRIGATÓRIOS estão presentes
      // antes de chegar aqui; um atributo extra sem match é só ignorado).
      const categoryAttributes = await this.client.getCategoryAttributes(partnerId, partnerKey, input.externalCategoryId);
      const attributeIdByName = new Map(categoryAttributes.map((a) => [a.original_attribute_name, a.attribute_id]));
      const attributeList: { attribute_id: number; attribute_value_list: { value: string }[] }[] = [];
      for (const [name, value] of Object.entries(input.attributes)) {
        const attributeId = attributeIdByName.get(name);
        if (attributeId == null) {
          this.logger.warn(`Shopee: atributo "${name}" não encontrado na categoria ${input.externalCategoryId} — descartado da publicação.`);
          continue;
        }
        attributeList.push({ attribute_id: attributeId, attribute_value_list: [{ value }] });
      }

      const result = await this.client.addItem(partnerId, partnerKey, shopId, accessToken, {
        item_name: input.title,
        description: input.title,
        category_id: Number(input.externalCategoryId),
        price: input.price,
        stock: input.availableQuantity,
        weight: input.weightKg,
        image_id_list: imageIds,
        attribute_list: attributeList,
      });
      if (!result.item_id) {
        return { success: false, message: result.message ?? 'Shopee não devolveu um item_id de anúncio.' };
      }
      return { success: true, externalListingId: result.item_id };
    } catch (error) {
      this.logger.warn(`Falha ao publicar anúncio na Shopee (tenant ${ctx.tenantId}): ${(error as Error).message}`);
      return { success: false, message: (error as Error).message };
    }
  }

  // Mesmo racional defensivo de ShopeeOrderProvider — duplicado aqui de
  // propósito (capacidades independentes, nada obriga compartilhar helper).
  private requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new InternalServerErrorException(`Variável de ambiente ${name} não configurada — a integração da Shopee não pode funcionar sem ela.`);
    }
    return value;
  }
}
