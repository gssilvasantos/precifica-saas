import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard } from '../../../identity-access/public-api';
import { ChangeEventsQueryService } from '../../application/change-events-query.service';

// Feed que alimenta o painel "Marketplace Intelligence" — acompanhar a
// evolução das políticas dos marketplaces ao longo do tempo.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('marketplace-intelligence/change-events')
export class MarketplaceChangeEventsController {
  constructor(private readonly changeEvents: ChangeEventsQueryService) {}

  @Get()
  list(@Query('marketplaceId') marketplaceId?: string, @Query('limit') limit?: string) {
    return this.changeEvents.list(marketplaceId, limit ? Number(limit) : undefined);
  }
}
