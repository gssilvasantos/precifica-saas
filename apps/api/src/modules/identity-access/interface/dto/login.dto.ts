import { IsEmail, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  // Opcional: só é necessário se o mesmo e-mail existir em mais de uma conta
  // (ex.: um contador que atende vários clientes do sistema). Nesse caso o
  // login sem tenantId retorna 409 com a lista de contas para o usuário escolher.
  @IsOptional()
  @IsString()
  tenantId?: string;
}
