import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CHANNEL_CATEGORY_MAPPING_REPOSITORY,
  ChannelCategoryMapping,
  ChannelCategoryMappingRepository,
} from './ports/channel-category-mapping-repository.port';
import { ListingProviderRegistry } from './listing-provider-registry.service';
import { PRODUCT_CATEGORY_READER } from '../../../shared/contracts/product-category-reader.port';
import type { ProductCategoryReader } from '../../../shared/contracts/product-category-reader.port';
import { ExternalCategoryAttribute, ExternalCategoryCandidate } from '../../../shared/contracts/marketplace-provider.contract';

// Orquestra o mapeamento categoria interna <-> categoria do canal (Fase 4,
// benchmark Tiny ERP) — espelha o fluxo real do Tiny/Olist confirmado com o
// usuário: buscar a categoria do canal por texto livre, escolher uma,
// consultar os atributos que ela exige, e salvar o vínculo. Nenhuma regra de
// negócio de publicação vive aqui — isso é ListingPublicationService; esta
// classe só CONFIGURA o mapeamento, nunca publica um anúncio.
@Injectable()
export class ChannelCategoryMappingService {
  constructor(
    @Inject(CHANNEL_CATEGORY_MAPPING_REPOSITORY) private readonly mappings: ChannelCategoryMappingRepository,
    @Inject(PRODUCT_CATEGORY_READER) private readonly categories: ProductCategoryReader,
    private readonly providers: ListingProviderRegistry,
  ) {}

  // Passo 1 do fluxo de configuração — busca por texto livre na API do
  // canal (nunca na árvore interna). Lança erro explícito se o canal não
  // tiver um provider com a capacidade CATEGORY_DISCOVERY registrada, em vez
  // de devolver uma lista vazia silenciosa (evita confundir "canal não
  // suportado" com "nenhum resultado para essa busca").
  async searchExternalCategories(marketplaceCode: string, query: string): Promise<ExternalCategoryCandidate[]> {
    const provider = this.requireCategoryDiscoveryProvider(marketplaceCode);
    return provider.searchCategories({ marketplaceCode }, query);
  }

  // Passo 2 — atributos que a categoria ESCOLHIDA do canal exige, consultado
  // ao vivo (nunca cacheado permanentemente, ver CategoryDiscoveryCapableProvider).
  async getExternalCategoryAttributes(marketplaceCode: string, externalCategoryId: string): Promise<ExternalCategoryAttribute[]> {
    const provider = this.requireCategoryDiscoveryProvider(marketplaceCode);
    return provider.getCategoryAttributes({ marketplaceCode }, externalCategoryId);
  }

  // Passo 3 — salva o vínculo. `upsert` (nunca create simples): reconfigurar
  // o mapeamento de uma categoria substitui o anterior, nunca acumula
  // duplicatas (chave: tenantId+categoryId+marketplaceCode).
  async setMapping(
    tenantId: string,
    categoryId: string,
    marketplaceCode: string,
    externalCategoryId: string,
    externalCategoryName: string,
  ): Promise<ChannelCategoryMapping> {
    const category = await this.categories.findById(tenantId, categoryId);
    if (!category) {
      throw new NotFoundException(`Categoria ${categoryId} não encontrada.`);
    }
    return this.mappings.upsert({
      tenantId,
      categoryId,
      marketplaceCode: marketplaceCode.toUpperCase(),
      externalCategoryId,
      externalCategoryName,
    });
  }

  async findMapping(tenantId: string, categoryId: string, marketplaceCode: string): Promise<ChannelCategoryMapping | null> {
    return this.mappings.findOne(tenantId, categoryId, marketplaceCode.toUpperCase());
  }

  async listMappingsForCategory(tenantId: string, categoryId: string): Promise<ChannelCategoryMapping[]> {
    return this.mappings.findAllByCategory(tenantId, categoryId);
  }

  async removeMapping(tenantId: string, id: string): Promise<void> {
    await this.mappings.remove(tenantId, id);
  }

  private requireCategoryDiscoveryProvider(marketplaceCode: string) {
    const provider = this.providers.findCategoryDiscoveryProvider(marketplaceCode);
    if (!provider) {
      throw new BadRequestException(`Nenhum provider de descoberta de categoria registrado para o canal "${marketplaceCode}".`);
    }
    return provider;
  }
}
