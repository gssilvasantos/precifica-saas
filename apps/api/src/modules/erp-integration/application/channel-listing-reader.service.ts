import { Inject, Injectable } from '@nestjs/common';
import { CHANNEL_LISTING_REPOSITORY, ChannelListingRepository } from './ports/channel-listing-repository.port';
import { ChannelListingReader, ChannelListingSummary } from '../../../shared/contracts/channel-listing-reader.port';

// Implementação da porta ChannelListingReader (shared/contracts/) — consumida
// pelo Pricing Intelligence. Só o erp-integration sabe da tabela ChannelListing.
@Injectable()
export class ChannelListingReaderService implements ChannelListingReader {
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
}
