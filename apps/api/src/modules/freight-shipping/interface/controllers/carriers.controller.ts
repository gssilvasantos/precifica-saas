import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { CarrierCatalogService } from '../../application/carrier-catalog.service';
import { CreateCarrierDto } from '../dto/create-carrier.dto';
import { UpdateCarrierDto } from '../dto/update-carrier.dto';
import { SetCarrierActiveDto } from '../dto/set-carrier-active.dto';
import { CreateCarrierServiceDto } from '../dto/create-carrier-service.dto';
import { UpdateCarrierServiceDto } from '../dto/update-carrier-service.dto';
import { SetCarrierServiceActiveDto } from '../dto/set-carrier-service-active.dto';

// Catálogo de Transportador/Serviço (Projeto Estruturante 5, benchmark Bling
// ERP, 29/07/2026, ver docs/carrier-catalog-architecture.md). Mesmo padrão de
// guards de FreightConnectionsController: ADMIN/PRICING_EDITOR grava, leitura
// liberada pra qualquer papel autenticado — este é um cadastro operacional
// (nenhum dado fiscal sensível envolvido, ao contrário de Naturezas de
// Operação).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('freight-shipping/carriers')
export class CarriersController {
  constructor(private readonly catalog: CarrierCatalogService) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  createCarrier(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCarrierDto) {
    return this.catalog.createCarrier(user.tenantId, dto);
  }

  @Get()
  findAllCarriers(@CurrentUser() user: AuthenticatedUser) {
    return this.catalog.findAllCarriers(user.tenantId);
  }

  // Resolve o CarrierService cadastrado correspondente a um formaEnvio
  // (texto livre) — usado para ENRIQUECER um DispatchBatch já criado. Vem
  // antes de ':id' para não colidir com a rota de detalhe.
  @Get('match')
  matchByFormaEnvio(@CurrentUser() user: AuthenticatedUser, @Query('formaEnvio') formaEnvio: string) {
    return this.catalog.matchByFormaEnvio(user.tenantId, formaEnvio ?? '');
  }

  @Get(':id')
  findCarrier(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.catalog.findCarrier(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id')
  updateCarrier(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCarrierDto) {
    return this.catalog.updateCarrier(user.tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id/active')
  setCarrierActive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SetCarrierActiveDto) {
    return this.catalog.setCarrierActive(user.tenantId, id, dto.isActive);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':carrierId/services')
  createService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('carrierId') carrierId: string,
    @Body() dto: CreateCarrierServiceDto,
  ) {
    return this.catalog.createService(user.tenantId, carrierId, dto);
  }

  @Get(':carrierId/services')
  findServicesByCarrier(@CurrentUser() user: AuthenticatedUser, @Param('carrierId') carrierId: string) {
    return this.catalog.findServicesByCarrier(user.tenantId, carrierId);
  }

  @Get(':carrierId/services/:serviceId')
  findService(@CurrentUser() user: AuthenticatedUser, @Param('serviceId') serviceId: string) {
    return this.catalog.findService(user.tenantId, serviceId);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':carrierId/services/:serviceId')
  updateService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serviceId') serviceId: string,
    @Body() dto: UpdateCarrierServiceDto,
  ) {
    return this.catalog.updateService(user.tenantId, serviceId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':carrierId/services/:serviceId/active')
  setServiceActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serviceId') serviceId: string,
    @Body() dto: SetCarrierServiceActiveDto,
  ) {
    return this.catalog.setServiceActive(user.tenantId, serviceId, dto.isActive);
  }
}
