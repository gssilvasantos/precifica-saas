import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { AccountsPayableService } from '../../application/accounts-payable.service';
import { CreateAccountsPayableDto } from '../dto/create-accounts-payable.dto';
import { UpdateAccountsPayableDto } from '../dto/update-accounts-payable.dto';
import { MarkAccountsPayablePaidDto } from '../dto/mark-accounts-payable-paid.dto';
import { AccountsPayableStatus } from '../../domain/accounts-payable.entity';

// "Minhas Contas a Pagar" — benchmark Tiny ERP (28/07/2026,
// docs/tiny-erp-benchmark-analysis.md, seção 1.4). Mesmo padrão de guards de
// ReceivablesController/WarehousesController: leitura liberada pra qualquer
// papel autenticado, escrita (criar/editar/baixar/cancelar) exige
// ADMIN/PRICING_EDITOR.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.FINANCE)
@Controller('financial-intelligence/accounts-payable')
export class AccountsPayableController {
  constructor(private readonly payables: AccountsPayableService) {}

  // Retorna array (não um único registro) — quando occurrence=PARCELADA,
  // uma chamada cria N linhas (as parcelas) de uma vez. Ver AccountsPayableService.create.
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAccountsPayableDto) {
    return this.payables.create(user.tenantId, {
      ...dto,
      dueDate: new Date(dto.dueDate),
    });
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: AccountsPayableStatus,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.payables.list(user.tenantId, { status, supplierId });
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payables.findOne(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateAccountsPayableDto) {
    return this.payables.update(user.tenantId, id, {
      ...dto,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
    });
  }

  // "Baixa" — único caminho que muda o status para PAID (ver comentário em
  // AccountsPayableService.markPaid). Rota própria, não um PATCH genérico:
  // dar baixa é uma ação de negócio distinta de editar campos.
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/pagar')
  markPaid(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: MarkAccountsPayablePaidDto) {
    return this.payables.markPaid(user.tenantId, id, dto.paidAt ? new Date(dto.paidAt) : undefined, {
      interestAmount: dto.interestAmount,
      discountAmount: dto.discountAmount,
      feeAmount: dto.feeAmount,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Delete(':id')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payables.cancel(user.tenantId, id);
  }
}
