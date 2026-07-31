import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AuthenticatedUser } from '../../domain/auth.types';
import { UserRole } from '@prisma/client';
import { UsersService } from '../../application/users.service';
import { CreateTeamMemberDto } from '../dto/create-team-member.dto';
import { UpdateTeamMemberDto } from '../dto/update-team-member.dto';
import { User } from '../../domain/user.entity';

// Painel de Equipe (30/07/2026) — só o ADMIN da própria conta gerencia quem
// tem acesso a ela. Nunca cross-tenant (diferente do platform-admin): tudo
// aqui é escopado pelo tenantId de quem está logado, via RLS normal (nunca
// bypass) — o próprio dono só vê/mexe na própria equipe.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('team')
export class TeamController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const members = await this.users.findAllByTenant(user.tenantId);
    return members.map(sanitize);
  }

  @Post()
  async invite(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTeamMemberDto) {
    const created = await this.users.createForTenant(user.tenantId, dto);
    return sanitize(created);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    const updated = await this.users.updateModuleAccessAndRole(user.tenantId, id, dto);
    return sanitize(updated);
  }

  @Patch(':id/block')
  async block(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const updated = await this.users.setActive(user.tenantId, id, false);
    return sanitize(updated);
  }

  @Patch(':id/unblock')
  async unblock(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const updated = await this.users.setActive(user.tenantId, id, true);
    return sanitize(updated);
  }
}

// Nunca devolve passwordHash pro frontend — nem por engano.
function sanitize(user: User): Omit<User, 'passwordHash'> {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}
