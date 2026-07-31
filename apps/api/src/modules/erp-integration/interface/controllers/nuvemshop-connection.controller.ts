import { BadRequestException, Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
  ModuleAccessGuard,
  RequireModule,
  ModuleCode,
} from '../../../identity-access/public-api';
import { NuvemshopConnectionService } from '../../application/nuvemshop-connection.service';
import { NuvemshopChannelListingSyncService } from '../../application/nuvemshop-channel-listing-sync.service';
import { ConnectNuvemshopDto } from '../dto/connect-nuvemshop.dto';

@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.INTEGRATIONS)
@Controller('erp-integration/nuvemshop')
export class NuvemshopConnectionController {
  constructor(
    private readonly connectionService: NuvemshopConnectionService,
    private readonly listingSync: NuvemshopChannelListingSyncService,
  ) {}

  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.connectionService.getStatus(user.tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Post('connect')
  connect(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConnectNuvemshopDto) {
    return this.connectionService.connect(user.tenantId, dto.storeId, dto.accessToken);
  }

  @Roles(UserRole.ADMIN)
  @Delete('connect')
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.connectionService.disconnect(user.tenantId);
  }

  // Mesmo fix de visibilidade do OlistConnectionController.syncNow (ver
  // comentário lá).
  @Roles(UserRole.ADMIN)
  @Post('sync-now')
  async syncNow(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.listingSync.syncTenant(user.tenantId);
    if (!result.success) {
      throw new BadRequestException(result.error ?? 'Falha desconhecida ao sincronizar com a Nuvemshop.');
    }
    return { triggered: true };
  }
}
