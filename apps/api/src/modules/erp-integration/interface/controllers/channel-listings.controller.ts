import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, CurrentUser, AuthenticatedUser } from '../../../identity-access/public-api';
import { ChannelListingsQueryService } from '../../application/channel-listings-query.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('erp-integration/channel-listings')
export class ChannelListingsController {
  constructor(private readonly listings: ChannelListingsQueryService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.listings.findAll(user.tenantId);
  }
}
