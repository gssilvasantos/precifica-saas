import { IsArray, IsEnum, IsIn, IsOptional } from 'class-validator';
import { UserRole } from '@prisma/client';
import { ModuleCode } from '../../../../shared/access-control/module-code';

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsArray()
  @IsIn(Object.values(ModuleCode), { each: true })
  moduleAccess?: ModuleCode[];
}
