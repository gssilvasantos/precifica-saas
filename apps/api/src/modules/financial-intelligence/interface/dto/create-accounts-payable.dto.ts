import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export enum AccountsPayableOccurrenceDto {
  UNICA = 'UNICA',
  SEMANAL = 'SEMANAL',
  MENSAL = 'MENSAL',
  TRIMESTRAL = 'TRIMESTRAL',
  PARCELADA = 'PARCELADA',
}

export class CreateAccountsPayableDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsDateString()
  dueDate!: string;

  @IsEnum(AccountsPayableOccurrenceDto)
  occurrence!: AccountsPayableOccurrenceDto;

  @IsOptional()
  @IsString()
  notes?: string;

  // Obrigatório só quando occurrence = PARCELADA — validado no service
  // (não dá pra expressar "obrigatório condicional a outro campo" de forma
  // limpa com decorators sem @ValidateIf; o service já valida isso mesmo).
  @IsOptional()
  @IsInt()
  @Min(2)
  totalInstallments?: number;
}
