import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

// Cria tenant + usuário admin em uma única chamada — é assim que uma conta
// nova nasce no produto (não existe "criar tenant" separado no MVP).
export class SignupDto {
  @IsString()
  tenantName!: string;

  @IsOptional()
  @IsString()
  tenantDocument?: string; // CNPJ

  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres' })
  password!: string;
}
