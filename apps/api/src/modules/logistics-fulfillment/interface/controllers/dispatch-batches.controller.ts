import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
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
import { DispatchBatchService } from '../../application/dispatch-batch.service';
import { CarrierCatalogService } from '../../../freight-shipping/application/carrier-catalog.service';
import { CreateDispatchBatchDto } from '../dto/create-dispatch-batch.dto';
import { AddOrderToBatchDto } from '../dto/add-order-to-batch.dto';
import { GenerateDispatchLabelDto } from '../dto/generate-dispatch-label.dto';

// Expedição em lote (Fase 5, benchmark Tiny ERP) — leitura liberada para
// qualquer papel autenticado; escrita (criar/gerenciar lote, gerar etiqueta,
// concluir/cancelar) exige ADMIN/PRICING_EDITOR, mesmo padrão do resto da
// base.
//
// Gate de módulo: CONFERENCE — mesmo fluxo de expedição/pick&pack da tela de
// Conferência.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.CONFERENCE)
@Controller('logistics-fulfillment/dispatch-batches')
export class DispatchBatchesController {
  constructor(
    private readonly dispatchBatches: DispatchBatchService,
    // Projeto Estruturante 5 (Catálogo de Transportador/Serviço) — consumido
    // só para RESOLVER carrierServiceId -> formaEnvio antes de chamar
    // createBatch; DispatchBatchService.createBatch continua recebendo
    // apenas a string formaEnvio, sem nenhuma mudança de assinatura.
    private readonly carrierCatalog: CarrierCatalogService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.dispatchBatches.listForTenant(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.dispatchBatches.findOne(user.tenantId, id);
  }

  // Enriquece o formaEnvio de um lote já existente com o transportador/
  // serviço cadastrado correspondente, se houver — leitura pura, nunca
  // altera o lote. Retorna null (sem lançar) quando nada bate no catálogo.
  @Get(':id/carrier-match')
  async carrierMatch(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { batch } = await this.dispatchBatches.findOne(user.tenantId, id);
    return this.carrierCatalog.matchByFormaEnvio(user.tenantId, batch.formaEnvio);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDispatchBatchDto) {
    const formaEnvio = dto.carrierServiceId
      ? await this.carrierCatalog.resolveFormaEnvioForCarrierService(user.tenantId, dto.carrierServiceId)
      : dto.formaEnvio;

    if (!formaEnvio) {
      throw new BadRequestException('Informe formaEnvio ou carrierServiceId.');
    }

    return this.dispatchBatches.createBatch(user.tenantId, formaEnvio, user.userId, dto.notes);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/orders')
  addOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddOrderToBatchDto) {
    return this.dispatchBatches.addOrder(user.tenantId, id, dto.orderId);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Delete(':id/orders/:batchOrderId')
  removeOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('batchOrderId') batchOrderId: string) {
    return this.dispatchBatches.removeOrder(user.tenantId, id, batchOrderId);
  }

  // Safety Lock (mesmo racional de ListingPublicationService/
  // AdsActionDispatcherService): gerar etiqueta é sempre uma ação manual do
  // operador, um pedido de cada vez, nunca automática/em massa silenciosa.
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/orders/:batchOrderId/generate-label')
  generateLabel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('batchOrderId') batchOrderId: string,
    @Body() dto: GenerateDispatchLabelDto,
  ) {
    const manualInput =
      dto.packageWeightKg != null && dto.recipientAddress
        ? {
            packageWeightKg: dto.packageWeightKg,
            declaredValue: dto.declaredValue,
            recipientAddress: dto.recipientAddress,
            avisoRecebimento: dto.avisoRecebimento,
            maoPropria: dto.maoPropria,
          }
        : undefined;
    return this.dispatchBatches.generateLabel(user.tenantId, id, batchOrderId, manualInput);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/conclude')
  conclude(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.dispatchBatches.concludeBatch(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.dispatchBatches.cancelBatch(user.tenantId, id);
  }
}
