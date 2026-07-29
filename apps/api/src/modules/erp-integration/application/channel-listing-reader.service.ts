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

  async upsert(input: ChannelListingWriterInput): Promise<void> {
    await this.listings.upsert(input);
  }
}
