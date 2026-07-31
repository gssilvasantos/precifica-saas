import { IsArray, IsEmail, IsEnum, IsIn, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { ModuleCode } from '../../../../shared/access-control/module-code';

// Convite de colaborador pela tela de Equipe — diferente do SignupDto (que
// cria tenant + primeiro usuário): aqui o tenant já existe, quem chama já é
// ADMIN da conta (ver TeamController, @Roles(ADMIN)).
export class CreateTeamMemberDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres' })
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsArray()
  @IsIn(Object.values(ModuleCode), { each: true })
  moduleAccess!: ModuleCode[];
}
