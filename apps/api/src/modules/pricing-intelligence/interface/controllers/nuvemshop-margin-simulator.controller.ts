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
import { NuvemshopMarginSimulatorService } from '../../application/nuvemshop-margin-simulator.service';
import { SimulateNuvemshopMarginDto } from '../dto/simulate-nuvemshop-margin.dto';

@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.CATALOG)
@Controller('pricing-intelligence/nuvemshop')
export class NuvemshopMarginSimulatorController {
  constructor(private readonly simulator: NuvemshopMarginSimulatorService) {}

  @Post('simulate')
  simulate(@CurrentUser() user: AuthenticatedUser, @Body() dto: SimulateNuvemshopMarginDto) {
    return this.simulator.simulate(user.tenantId, dto);
  }
}
