import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { NaturezaOperacaoService } from '../../application/natureza-operacao.service';
import { CreateNaturezaOperacaoDto } from '../dto/create-natureza-operacao.dto';
import { UpdateNaturezaOperacaoDto } from '../dto/update-natureza-operacao.dto';
import { SetNaturezaOperacaoActiveDto } from '../dto/set-natureza-operacao-active.dto';

// Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
// 29/07/2026, ver docs/naturezas-operacao-architecture.md). Só ADMIN
// cadastra/edita — mesmo racional de FiscalMarketplaceIntermediariesController
// (dado fiscal sensível, com consequência legal na emissão de NF-e).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('fiscal/naturezas-operacao')
export class NaturezasOperacaoController {
  constructor(private readonly naturezasOperacao: NaturezaOperacaoService) {}

  @Roles(UserRole.ADMIN)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNaturezaOperacaoDto) {
    return this.naturezasOperacao.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.naturezasOperacao.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.naturezasOperacao.findOne(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateNaturezaOperacaoDto) {
    return this.naturezasOperacao.update(user.tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/active')
  setActive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SetNaturezaOperacaoActiveDto) {
    return this.naturezasOperacao.setActive(user.tenantId, id, dto.isActive);
  }
}
