import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { TaxProfilesService } from '../../application/tax-profiles.service';
import { CreateTaxProfileDto } from '../dto/create-tax-profile.dto';
import { UpdateTaxProfileDto } from '../dto/update-tax-profile.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tax-profiles')
export class TaxProfilesController {
  constructor(private readonly taxProfiles: TaxProfilesService) {}

  @Roles(UserRole.ADMIN)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaxProfileDto) {
    return this.taxProfiles.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.taxProfiles.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.taxProfiles.findOne(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateTaxProfileDto) {
    return this.taxProfiles.update(user.tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.taxProfiles.remove(user.tenantId, id);
  }
}
