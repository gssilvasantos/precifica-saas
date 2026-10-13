import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  CurrentUser,
  AuthenticatedUser,
  ModuleAccessGuard,
  RequireModule,
  ModuleCode,
} from '../../../identity-access/public-api';
import { ShopeeMarginSimulatorService } from '../../application/shopee-margin-simulator.service';
import { SimulateShopeeMarginDto } from '../dto/simulate-shopee-margin.dto';

@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.CATALOG)
@Controller('pricing-intelligence/shopee')
export class ShopeeMarginSimulatorController {
  constructor(private readonly simulator: ShopeeMarginSimulatorService) {}

  @Post('simulate')
  simulate(@CurrentUser() user: AuthenticatedUser, @Body() dto: SimulateShopeeMarginDto) {
    return this.simulator.simulate(user.tenantId, dto);
  }
}
