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
import { MercadoLivreMarginSimulatorService } from '../../application/mercado-livre-margin-simulator.service';
import { SimulateMercadoLivreMarginDto } from '../dto/simulate-mercado-livre-margin.dto';

@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.CATALOG)
@Controller('pricing-intelligence/mercado-livre')
export class MercadoLivreMarginSimulatorController {
  constructor(private readonly simulator: MercadoLivreMarginSimulatorService) {}

  @Post('simulate')
  simulate(@CurrentUser() user: AuthenticatedUser, @Body() dto: SimulateMercadoLivreMarginDto) {
    return this.simulator.simulate(user.tenantId, dto);
  }
}
