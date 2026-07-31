import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
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
import { FreightProviderConnectionService } from '../../application/freight-provider-connection.service';
import { UpsertFreightConnectionDto } from '../dto/upsert-freight-connection.dto';

// Conexão/credencial de transportadora avulsa (Fase 5, Expedição em lote) —
// mesmo padrão de guards do resto da base: só ADMIN/PRICING_EDITOR grava
// credencial, leitura (nunca devolve o segredo, ver
// FreightProviderConnectionService.omitCredential) liberada pra qualquer
// papel autenticado.
//
// Gate de módulo: CONFERENCE — consumido só por DispatchBatchesController.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.CONFERENCE)
@Controller('freight-shipping/connections')
export class FreightConnectionsController {
  constructor(private readonly connections: FreightProviderConnectionService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.connections.listForTenant(user.tenantId);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertFreightConnectionDto) {
    return this.connections.upsert(user.tenantId, dto.providerCode, dto.credential);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Delete(':providerCode')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('providerCode') providerCode: string) {
    return this.connections.remove(user.tenantId, providerCode);
  }
}
