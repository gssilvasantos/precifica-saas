import { Inject, Injectable } from '@nestjs/common';
import { CHANNEL_LISTING_REPOSITORY, ChannelListingRepository } from './ports/channel-listing-repository.port';
import {
  ChannelListingReader,
  ChannelListingSummary,
  ChannelListingWriter,
  ChannelListingWriterInput,
} from '../../../shared/contracts/channel-listing-reader.port';

// Implementação das portas ChannelListingReader/ChannelListingWriter
// (shared/contracts/) — consumidas pelo Pricing Intelligence (leitura) e pelo
// ListingPublicationService (escrita, Fase 4 benchmark Tiny ERP). Só o
// erp-integration sabe da tabela ChannelListing.
@Injectable()
export class ChannelListingReaderService implements ChannelListingReader, ChannelListingWriter {
  constructor(@Inject(CHANNEL_LISTING_REPOSITORY) private readonly listings: ChannelListingRepository) {}

  async findBySku(tenantId: string, channelCode: string, skuCode: string): Promise<ChannelListingSummary | null> {
    const record = await this.listings.findBySku(tenantId, channelCode, skuCode);
    if (!record) return null;
    return {
      channelCode: record.channelCode,
      externalId: record.externalId,
      currentPrice: record.currentPrice,
      url: record.url,
    };
  }

  // Direção inversa (01/08/2026) — anúncio do canal -> SKU. Ver comentário
  // do contrato: é o vínculo que traduz o gasto de Ads por item (dado que a
  // API do Mercado Livre entrega no nível do anúncio) para o produto.
  async findSkusByExternalIds(
    tenantId: string,
    channelCode: string,
    externalIds: string[],
  ): Promise<{ externalId: string; skuCode: string }[]> {
    if (externalIds.length === 0) return [];
    return this.listings.findSkusByExternalIds(tenantId, channelCode, externalIds);
  }

  async upsert(input: ChannelListingWriterInput): Promise<void> {
    await this.listings.upsert(input);
  }
}
