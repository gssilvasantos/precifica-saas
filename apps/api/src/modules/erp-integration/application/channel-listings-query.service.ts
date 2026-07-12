import { Inject, Injectable } from '@nestjs/common';
import { CHANNEL_LISTING_REPOSITORY, ChannelListingRepository } from './ports/channel-listing-repository.port';

@Injectable()
export class ChannelListingsQueryService {
  constructor(@Inject(CHANNEL_LISTING_REPOSITORY) private readonly listings: ChannelListingRepository) {}

  findAll(tenantId: string) {
    return this.listings.findAllByTenant(tenantId);
  }
}
