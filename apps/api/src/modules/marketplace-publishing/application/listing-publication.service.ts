import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  LISTING_PUBLICATION_REPOSITORY,
  ListingPublicationRepository,
} from './ports/listing-publication-repository.port';
import { CHANNEL_CATEGORY_MAPPING_REPOSITORY, ChannelCategoryMappingRepository } from './ports/channel-category-mapping-repository.port';
import { ListingProviderRegistry } from './listing-provider-registry.service';
import { ListingPublication, PublishableProduct, canPublish } from '../domain/listing-publication.entity';
import { PRODUCT_CATALOG_READER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { PRODUCT_CATEGORY_READER } from '../../../shared/contracts/product-category-reader.port';
import type { ProductCategoryReader } from '../../../shared/contracts/product-category-reader.port';
import { CHANNEL_LISTING_WRITER } from '../../../shared/contracts/tokens';
import type { ChannelListingWriter } from '../../../shared/contracts/channel-listing-reader.port';

export interface PublishListingInput {
  price: number;
  availableQuantity: number;
  currency?: string;
  // Sobrescreve/complementa os atributos herdados da categoria interna — ex.:
  // "Cor" varia por produto mesmo dentro da mesma categoria (ver
  // domain/listing-publication.entity.ts, canPublish).
  overrideAttributes?: Record<string, string>;
}

// Orquestra a publicação MANUAL de um anúncio novo (Fase 4, benchmark Tiny
// ERP) — sempre disparada por ação explícita do usuário (Safety Lock, MESMO
// racional de AdsActionDispatcherService): criar um anúncio público tem
// consequência externa/reputacional real e irreversível de desfazer, então
// nunca roda automaticamente/agendado.
@Injectable()
export class ListingPublicationService {
  private readonly logger = new Logger(ListingPublicationService.name);

  constructor(
    @Inject(LISTING_PUBLICATION_REPOSITORY) private readonly publications: ListingPublicationRepository,
    @Inject(CHANNEL_CATEGORY_MAPPING_REPOSITORY) private readonly mappings: ChannelCategoryMappingRepository,
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    @Inject(PRODUCT_CATEGORY_READER) private readonly categories: ProductCategoryReader,
    @Inject(CHANNEL_LISTING_WRITER) private readonly channelListings: ChannelListingWriter,
    private readonly providers: ListingProviderRegistry,
  ) {}

  // skuCode (não productId) é o identificador de entrada — MESMO padrão já
  // usado por FiscalInvoiceService.resolveItems/PricingDecisionService: o
  // produto é sempre resolvido via PRODUCT_CATALOG_READER.findBySku, nunca
  // por um ID interno do Catalog que este módulo não deveria conhecer.
  async publish(tenantId: string, skuCode: string, marketplaceCode: string, input: PublishListingInput): Promise<ListingPublication> {
    const normalizedChannel = marketplaceCode.toUpperCase();
    const listingProvider = this.providers.findListingCreateProvider(normalizedChannel);
    if (!listingProvider) {
      throw new BadRequestException(`Nenhum provider de publicação registrado para o canal "${normalizedChannel}".`);
    }

    const product = await this.catalog.findBySku(tenantId, skuCode);
    if (!product) {
      throw new NotFoundException(`Produto com SKU ${skuCode} não encontrado.`);
    }

    const mapping = product.categoryId ? await this.mappings.findOne(tenantId, product.categoryId, normalizedChannel) : null;
    const effectiveAttributes = product.categoryId ? await this.categories.resolveEffectiveAttributes(tenantId, product.categoryId) : {};

    // Atributos obrigatórios só são consultáveis se já existe mapeamento
    // (precisa do externalCategoryId) — sem mapeamento, o gate abaixo já
    // rejeita antes disso importar (canPublish checa `mapping` primeiro).
    const categoryDiscovery = mapping ? this.providers.findCategoryDiscoveryProvider(normalizedChannel) : undefined;
    const requiredAttributes = mapping && categoryDiscovery
      ? await categoryDiscovery.getCategoryAttributes({ marketplaceCode: normalizedChannel, tenantId }, mapping.externalCategoryId)
      : [];

    const publishableProduct: PublishableProduct = {
      name: product.name,
      photoUrls: product.photoUrls,
      weightKg: product.weightKg,
      categoryId: product.categoryId,
    };
    const overrideAttributes = input.overrideAttributes ?? {};

    const gate = canPublish({
      product: publishableProduct,
      mapping: mapping ? { externalCategoryId: mapping.externalCategoryId, externalCategoryName: mapping.externalCategoryName } : null,
      effectiveAttributes,
      overrideAttributes,
      requiredAttributes,
    });
    if (!gate.ok) {
      throw new BadRequestException(gate.reason);
    }

    // mapping é garantidamente não-nulo aqui — canPublish já rejeitou o caso
    // contrário acima (TypeScript não infere isso sozinho através do gate).
    const resolvedMapping = mapping!;
    const mergedAttributes = { ...effectiveAttributes, ...overrideAttributes };
    const currency = input.currency ?? 'BRL';

    const record = await this.publications.create({
      tenantId,
      productId: product.productId,
      skuCode: product.skuCode,
      marketplaceCode: normalizedChannel,
      requestPayload: {
        title: product.name,
        externalCategoryId: resolvedMapping.externalCategoryId,
        price: input.price,
        currency,
        availableQuantity: input.availableQuantity,
        pictureUrls: product.photoUrls,
        weightKg: product.weightKg,
        attributes: mergedAttributes,
      },
    });

    try {
      const result = await listingProvider.createListing(
        { marketplaceCode: normalizedChannel, tenantId },
        {
          title: product.name,
          externalCategoryId: resolvedMapping.externalCategoryId,
          price: input.price,
          currency,
          availableQuantity: input.availableQuantity,
          pictureUrls: product.photoUrls,
          weightKg: product.weightKg,
          attributes: mergedAttributes,
        },
      );

      if (!result.success || !result.externalListingId) {
        return this.publications.markError(record.id, result.message ?? 'O marketplace recusou a publicação sem detalhar o motivo.');
      }

      const published = await this.publications.markPublished(record.id, result.externalListingId);
      // Vincula o SKU ao anúncio recém-criado — mesma tabela ChannelListing
      // que o resto da plataforma usa (repricing, leitura de preço vigente).
      // Falha aqui NUNCA desfaz a publicação já confirmada pelo marketplace
      // (o anúncio existe de verdade do lado de lá); só loga um aviso.
      try {
        await this.channelListings.upsert({
          tenantId,
          skuCode: product.skuCode,
          channelCode: normalizedChannel,
          externalId: result.externalListingId,
          currentPrice: input.price,
          url: null,
        });
      } catch (error) {
        this.logger.warn(
          `Anúncio publicado com sucesso (${result.externalListingId}) mas falhou ao vincular ChannelListing: ${(error as Error).message}`,
        );
      }
      return published;
    } catch (error) {
      this.logger.error(`Falha de comunicação ao publicar anúncio (SKU ${skuCode}, canal ${normalizedChannel}): ${(error as Error).message}`);
      return this.publications.markError(record.id, (error as Error).message);
    }
  }

  async findOne(tenantId: string, id: string): Promise<ListingPublication> {
    const publication = await this.publications.findById(tenantId, id);
    if (!publication) {
      throw new NotFoundException(`Publicação ${id} não encontrada.`);
    }
    return publication;
  }

  async findAllByProduct(tenantId: string, productId: string): Promise<ListingPublication[]> {
    return this.publications.findAllByProduct(tenantId, productId);
  }
}
