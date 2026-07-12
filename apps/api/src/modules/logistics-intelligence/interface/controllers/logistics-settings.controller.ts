import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { LogisticsSettingsService } from '../../application/logistics-settings.service';
import { UpdateLogisticsSettingsDto } from '../dto/update-logistics-settings.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('logistics-intelligence/settings')
export class LogisticsSettingsController {
  constructor(private readonly settings: LogisticsSettingsService) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser) {
    const cubicWeightFactor = await this.settings.getCubicWeightFactor(user.tenantId);
    return { cubicWeightFactor };
  }

  @Roles(UserRole.ADMIN)
  @Put()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateLogisticsSettingsDto) {
    return this.settings.updateCubicWeightFactor(user.tenantId, dto.cubicWeightFactor);
  }
}
